import { Express, Request, Response, NextFunction } from "express";
import { Server } from "http";
import { v4 as uuidv4 } from "uuid";
import { 
  sendUsdcSchema, 
  claimUsdcSchema, 
  regenerateClaimLinkSchema, 
  reclaimUsdcSchema, 
  signedTransactionSchema,
  atomicTransactionGroupSchema,
  completeFundingSchema
} from "@shared/schema";
import { 
  createEscrowAccount, 
  prepareFundEscrowTransaction,
  prepareCompleteEscrowDeployment,
  submitSignedTransaction,
  claimFromEscrow,
  claimFromEscrowWithCompiledTeal,
  reclaimFromEscrow,
  getUserBalance,
  optInEscrowToUSDC,
  executeClaimTransaction,
  debugEscrow
} from "./algorand-algokit";

// Import new app-based approach
import {
  createClaimApp,
  prepareAppFundingTransactions,
  prepareClaimTransaction,
  prepareReclaimTransaction,
  submitTransaction,
  getUsdcBalance,
  algodClient,
  compileProgram
} from "./algorand-apps";
import { prepareAppCallForOptIn } from "./app-lsig";
import { USDC_ASSET_ID } from "../client/src/lib/constants";
import { sendClaimEmail } from "./email";
import { storage } from "./storage";
import algosdk from "algosdk";

export async function registerRoutes(app: Express): Promise<Server> {
  // Handle errors globally
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack);
    res.status(500).send({ error: err.message || "Something went wrong!" });
  });
  
  const getAppDomain = (req: Request): string => {
    const protocol = req.secure ? 'https' : 'http';
    const host = req.headers.host || 'localhost:3000';
    return `${protocol}://${host}`;
  };
  
  // Get transactions by sender address
  app.get("/api/transactions", async (req: Request, res: Response) => {
    const senderAddress = req.query.senderAddress as string;
    
    if (!senderAddress) {
      return res.status(400).json({ message: "Sender address is required" });
    }
    
    try {
      const transactions = await storage.getTransactionsBySender(senderAddress);
      return res.json(transactions);
    } catch (error) {
      console.error("Error getting transactions:", error);
      return res.status(500).json({ message: "Failed to get transactions" });
    }
  });
  
  // Get user's balance
  app.get("/api/balance", async (req: Request, res: Response) => {
    const address = req.query.address as string;
    
    if (!address) {
      return res.status(400).json({ message: "Address is required" });
    }
    
    try {
      const balance = await getUsdcBalance(address);
      return res.json({ balance });
    } catch (error) {
      console.error("Error getting balance:", error);
      return res.status(500).json({ message: "Failed to get balance" });
    }
  });

  // Submit a signed transaction
  app.post("/api/submit-transaction", async (req: Request, res: Response) => {
    try {
      const result = signedTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { signedTxn, transactionId, approach } = result.data;
      
      if (!signedTxn) {
        return res.status(400).json({ message: "Signed transaction is required" });
      }
      
      console.log(`Processing signed transaction...`);
      const signedTxnBuffer = Buffer.from(signedTxn, 'base64');
      
      // Use the appropriate submit function based on the approach
      let txId;
      if (approach === 'app') {
        txId = await submitTransaction(signedTxnBuffer);
      } else {
        txId = await submitSignedTransaction(signedTxnBuffer);
      }
      
      console.log(`Transaction submitted with ID: ${txId}`);
      
      return res.json({
        success: true,
        transactionId: txId,
        status: "success"
      });
    } catch (error) {
      console.error("Error submitting signed transaction:", error);
      return res.status(500).json({ message: "Failed to submit transaction" });
    }
  });

  // Create a new transaction (send USDC) - Simplified to create app only
  // Create a new transaction (send USDC) - Simplified to create app only
aapp.post("/api/send", async (req: Request, res: Response) => {
  try {
    const result = sendUsdcSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error.message });
    }
    
    const { senderAddress, recipientEmail, amount, note } = result.data;
    const roundedAmount = Math.round(parseFloat(amount) * 100) / 100;
    
    // Generate claim token
    const claimToken = uuidv4();
    
    // Get suggested params
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Create TEAL programs
    const approvalProgram = await createApprovalProgram(senderAddress);
    const clearProgram = `#pragma version 8\nint 1\nreturn`;
    
    // Compile programs
    const compiledApproval = await compileProgram(approvalProgram);
    const compiledClear = await compileProgram(clearProgram);
    
    // Prepare transactions
    const transactions = [];
    
    // 1. Create application
    const createAppTxn = algosdk.makeApplicationCreateTxnFromObject({
      from: senderAddress,
      approvalProgram: compiledApproval,
      clearProgram: compiledClear,
      numLocalInts: 0,
      numLocalByteSlices: 0,
      numGlobalInts: 1,
      numGlobalByteSlices: 2,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams
    });
    transactions.push(createAppTxn);
    
    // Note: We can't create the funding and opt-in transactions yet
    // because we don't know the app ID until after creation
    // These will need to be done in a second phase
    
    // Encode transactions for frontend
    const txnsBase64 = transactions.map(txn => 
      Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64')
    );
    
    // Create transaction record (without app ID yet)
    const transaction = await storage.createTransaction({
      senderAddress,
      recipientEmail,
      amount: roundedAmount.toString(),
      note: note || "",
      claimToken,
      approach: "app"
    });
    
    return res.json({
      success: true,
      claimToken,
      transactions: {
        txnsBase64,
        phase: "create_app"
      },
      transactionId: transaction.id
    });
  } catch (error) {
    console.error("Send API error:", error);
    return res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : "Failed to create transaction" 
    });
  }
});

  // New endpoint to complete funding after app is created
  app.post("/api/complete-app-setup", async (req: Request, res: Response) => {
    try {
      const { appId, transactionId } = req.body;
      
      console.log(`Completing setup for app ${appId}`);
      
      // Get transaction details from database
      const transaction = await storage.getTransactionById(transactionId);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      // Get the actual app address from the blockchain
      const appAddress = algosdk.getApplicationAddress(appId);
      
      // Update the transaction with the actual app ID and address
      await storage.updateTransaction(transactionId, {
        appId,
        appAddress
      });
      
      const amount = parseFloat(transaction.amount);
      const senderAddress = transaction.senderAddress;
      const suggestedParams = await algodClient.getTransactionParams().do();
      
      // Create three separate transactions (not grouped)
      const transactions = [];
      
      // 1. Fund app with ALGO
      const fundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: senderAddress,
        to: appAddress,
        amount: 300000, // 0.3 ALGO
        suggestedParams
      });
      transactions.push(Buffer.from(algosdk.encodeUnsignedTransaction(fundingTxn)).toString('base64'));
      
      // 2. Call app to opt-in to USDC (using inner transaction)
      const optInCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        from: senderAddress,
        appIndex: appId,
        appArgs: [new Uint8Array(Buffer.from("opt_in"))],
        suggestedParams
      });
      transactions.push(Buffer.from(algosdk.encodeUnsignedTransaction(optInCallTxn)).toString('base64'));
      
      // 3. Transfer USDC to app
      const microAmount = Math.floor(amount * 1_000_000);
      const usdcTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: senderAddress,
        to: appAddress,
        amount: microAmount,
        assetIndex: USDC_ASSET_ID,
        suggestedParams
      });
      transactions.push(Buffer.from(algosdk.encodeUnsignedTransaction(usdcTransferTxn)).toString('base64'));
      
      return res.json({
        success: true,
        phase: "complete_setup",
        transactions: {
          txnsBase64: transactions
        },
        appId,
        appAddress
      });
    } catch (error) {
      console.error("Error completing app setup:", error);
      return res.status(500).json({ message: "Failed to complete app setup" });
    }
  });
  
  // Claim USDC from a transaction
  app.post("/api/claim", async (req: Request, res: Response) => {
    try {
      const result = claimUsdcSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { claimToken, recipientAddress } = result.data;
      
      // Look up transaction by claim token
      const transaction = await storage.getTransactionByClaimToken(claimToken);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      if (transaction.claimed) {
        return res.status(400).json({ message: "Transaction already claimed" });
      }
      
      // Check if the transaction has an expiration date and if it's expired
      if (transaction.expiresAt && new Date(transaction.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Transaction has expired" });
      }
      
      try {
        let txnsBase64 = [];
        
        // Use the appropriate claim method based on the approach
        if (transaction.approach === 'app' && transaction.appId && transaction.appAddress) {
          // Use app-based approach
          console.log(`Preparing to claim from app ${transaction.appId} at address ${transaction.appAddress}`);
          
          // Prepare the claim transaction
          const claimTxn = await prepareClaimTransaction(
            transaction.appId,
            transaction.appAddress,
            recipientAddress,
            parseFloat(transaction.amount)
          );
          
          // Encode the transaction as base64
          txnsBase64.push(Buffer.from(claimTxn).toString('base64'));
        } else {
          // Use LogicSig escrow approach (default/backward compatibility)
          console.log(`Preparing to claim from escrow using LogicSig at address ${transaction.escrowAddress}`);
          
          // If we have the compiled TEAL program, use it directly
          if (transaction.compiledTealProgram) {
            console.log("Using stored compiled TEAL program");
            const txn = await claimFromEscrowWithCompiledTeal({
              escrowAddress: transaction.escrowAddress || "",
              compiledTeal: transaction.compiledTealProgram,
              tealSource: transaction.tealSource || "",
              salt: transaction.tealSalt || "",
              recipientAddress,
              amount: parseFloat(transaction.amount)
            });
            
            txnsBase64.push(Buffer.from(txn).toString('base64'));
          } else {
            console.log("No compiled TEAL program available, generating new LogicSig");
            // Otherwise, try to generate a new LogicSig
            const txn = await claimFromEscrow(
              transaction.escrowLogicSig || "",
              transaction.escrowAddress || "",
              recipientAddress,
              parseFloat(transaction.amount)
            );
            
            txnsBase64.push(Buffer.from(txn).toString('base64'));
          }
        }
        
        return res.json({
          success: true,
          transactionId: transaction.id,
          txnsBase64
        });
      } catch (error) {
        console.error("Error preparing claim transaction:", error);
        return res.status(500).json({ message: `Failed to prepare claim transaction: ${error}` });
      }
    } catch (error) {
      console.error("Claim API error:", error);
      return res.status(500).json({ message: "Failed to process claim request" });
    }
  });
  
  // Get claim details
  app.get("/api/claim/:token", async (req: Request, res: Response) => {
    try {
      const claimToken = req.params.token;
      
      if (!claimToken) {
        return res.status(400).json({ message: "Claim token is required" });
      }
      
      const transaction = await storage.getTransactionByClaimToken(claimToken);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      // Return claim details
      return res.json({
        success: true,
        transaction: {
          id: transaction.id,
          senderAddress: transaction.senderAddress,
          amount: transaction.amount,
          note: transaction.note,
          claimed: transaction.claimed,
          approach: transaction.approach || "logicsig",
          appId: transaction.appId,
          appAddress: transaction.appAddress,
        }
      });
    } catch (error) {
      console.error("Error getting claim details:", error);
      return res.status(500).json({ message: "Failed to get claim details" });
    }
  });
  
  // Regenerate a claim link
  app.post("/api/regenerate-link", async (req: Request, res: Response) => {
    try {
      const result = regenerateClaimLinkSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { transactionId } = result.data;
      
      // Look up transaction by ID
      const transaction = await storage.getTransactionById(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      if (transaction.claimed) {
        return res.status(400).json({ message: "Transaction already claimed" });
      }
      
      // Generate a new claim token
      const updatedTransaction = await storage.updateTransactionClaimToken(transactionId);
      
      if (!updatedTransaction) {
        return res.status(500).json({ message: "Failed to update claim token" });
      }
      
      // Send an email with the new claim link
      const appDomain = getAppDomain(req);
      try {
        await sendClaimEmail({
          recipientEmail: transaction.recipientEmail,
          amount: transaction.amount,
          note: transaction.note || "",
          senderAddress: transaction.senderAddress,
          claimToken: updatedTransaction.claimToken,
          appDomain
        });
      } catch (emailError) {
        console.error("Email sending failed:", emailError);
        // We still return success since the token was updated
      }
      
      return res.json({
        success: true,
        claimLink: `${appDomain}/claim/${updatedTransaction.claimToken}`,
        claimToken: updatedTransaction.claimToken
      });
    } catch (error) {
      console.error("Regenerate link API error:", error);
      return res.status(500).json({ message: "Failed to regenerate claim link" });
    }
  });

  app.post("/api/complete-app-setup", async (req: Request, res: Response) => {
    try {
      const { transactionId, appId } = req.body;
      
      if (!transactionId || !appId) {
        return res.status(400).json({ 
          success: false, 
          message: "Transaction ID and App ID are required" 
        });
      }
      
      // Get transaction from database
      const transaction = await storage.getTransactionById(transactionId);
      if (!transaction) {
        return res.status(404).json({ 
          success: false, 
          message: "Transaction not found" 
        });
      }
      
      // Calculate app address
      const appAddress = algosdk.getApplicationAddress(appId);
      
      // Update transaction with app details
      await storage.updateTransaction(transactionId, {
        appId,
        appAddress: appAddress.toString()
      });
      
      // Get suggested params
      const suggestedParams = await algodClient.getTransactionParams().do();
      
      // Prepare phase 2 transactions
      const transactions = [];
      
      // 1. Fund app with minimum balance
      const fundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: transaction.senderAddress,
        to: appAddress.toString(),
        amount: 200000, // 0.2 ALGO
        suggestedParams
      });
      transactions.push(fundingTxn);
      
      // 2. App call for opt-in
      const optInCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        from: transaction.senderAddress,
        appIndex: appId,
        appArgs: [new Uint8Array(Buffer.from("opt_in_to_asset"))],
        foreignAssets: [USDC_ASSET_ID],
        suggestedParams
      });
      transactions.push(optInCallTxn);
      
      // 3. Asset opt-in from app
      const assetOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: appAddress.toString(),
        to: appAddress.toString(),
        amount: 0,
        assetIndex: USDC_ASSET_ID,
        suggestedParams
      });
      transactions.push(assetOptInTxn);
      
      // 4. Transfer USDC to app
      const microAmount = Math.floor(parseFloat(transaction.amount) * 1_000_000);
      const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: transaction.senderAddress,
        to: appAddress.toString(),
        amount: microAmount,
        assetIndex: USDC_ASSET_ID,
        suggestedParams
      });
      transactions.push(transferTxn);
      
      // Group transactions
      algosdk.assignGroupID(transactions);
      
      // The app needs to sign the opt-in transaction
      // Create a logic signature for the app
      const appLogicSig = await createAppLogicSig(appId);
      const signedOptInTxn = algosdk.signLogicSigTransaction(assetOptInTxn, appLogicSig);
      
      // Prepare transactions for frontend
      const txnsBase64 = [
        Buffer.from(algosdk.encodeUnsignedTransaction(fundingTxn)).toString('base64'),
        Buffer.from(algosdk.encodeUnsignedTransaction(optInCallTxn)).toString('base64'),
        Buffer.from(signedOptInTxn.blob).toString('base64'), // Pre-signed
        Buffer.from(algosdk.encodeUnsignedTransaction(transferTxn)).toString('base64')
      ];
      
      return res.json({
        success: true,
        appAddress: appAddress.toString(),
        transactions: {
          txnsBase64,
          indexesToSign: [0, 1, 3], // Frontend only signs these
          phase: "fund_and_transfer"
        }
      });
    } catch (error) {
      console.error("Complete app setup error:", error);
      return res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : "Failed to complete app setup" 
      });
    }
  });
  
  // Reclaim USDC from a transaction
  app.post("/api/reclaim", async (req: Request, res: Response) => {
    try {
      const result = reclaimUsdcSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { transactionId, senderAddress } = result.data;
      
      // Look up transaction by ID
      const transaction = await storage.getTransactionById(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      if (transaction.claimed) {
        return res.status(400).json({ message: "Transaction already claimed" });
      }
      
      // Verify the sender address matches
      if (transaction.senderAddress !== senderAddress) {
        return res.status(403).json({ message: "Not authorized to reclaim this transaction" });
      }
      
      try {
        let txnsBase64 = [];
        
        // Use the appropriate reclaim method based on the approach
        if (transaction.approach === 'app' && transaction.appId && transaction.appAddress) {
          // Use app-based approach
          console.log(`Preparing to reclaim from app ${transaction.appId} at address ${transaction.appAddress}`);
          
          // Prepare the reclaim transaction
          const reclaimTxn = await prepareReclaimTransaction(
            transaction.appId,
            transaction.appAddress,
            senderAddress,
            parseFloat(transaction.amount)
          );
          
          // Encode the transaction as base64
          txnsBase64.push(Buffer.from(reclaimTxn).toString('base64'));
        } else {
          // Use LogicSig escrow approach (default/backward compatibility)
          console.log(`Preparing to reclaim from escrow using LogicSig at address ${transaction.escrowAddress}`);
          
          const txn = await reclaimFromEscrow(
            transaction.escrowLogicSig || "",
            transaction.escrowAddress || "",
            senderAddress,
            parseFloat(transaction.amount)
          );
          
          txnsBase64.push(Buffer.from(txn).toString('base64'));
        }
        
        return res.json({
          success: true,
          transactionId: transaction.id,
          txnsBase64
        });
      } catch (error) {
        console.error("Error preparing reclaim transaction:", error);
        return res.status(500).json({ message: `Failed to prepare reclaim transaction: ${error}` });
      }
    } catch (error) {
      console.error("Reclaim API error:", error);
      return res.status(500).json({ message: "Failed to process reclaim request" });
    }
  });
  
  // Return the app instance to caller so other middleware can be attached
  console.log('Routes registered successfully');
  return new Server(app);
}