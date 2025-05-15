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
      // Use the new getUsdcBalance function from algorand-apps
      const balance = await getUsdcBalance(address);
      return res.json({ balance });
    } catch (error) {
      console.error("Error getting balance:", error);
      return res.status(500).json({ message: "Failed to get balance" });
    }
  });
  
  // Submit a claim for USDC
  app.post("/api/submit-claim", async (req: Request, res: Response) => {
    const { claimToken, signedTransaction } = req.body;
    
    if (!claimToken || !signedTransaction) {
      return res.status(400).json({ message: "Claim token and signed transaction are required" });
    }
    
    try {
      // Decode base64 transaction
      const txn = Buffer.from(signedTransaction, 'base64');
      
      // Execute the claim
      const result = await executeClaimTransaction(txn);
      
      if (result && result.txId) {
        // Mark transaction as claimed in our database
        const transaction = await storage.getTransactionByClaimToken(claimToken);
        
        if (transaction) {
          const updatedTransaction = await storage.markTransactionAsClaimed(
            transaction.id,
            "recipient-address", // This should be extracted from the transaction
            result.txId
          );
          
          return res.json({
            success: true,
            transactionId: result.txId,
            transaction: updatedTransaction
          });
        }
      }
      
      return res.status(500).json({ message: "Failed to process claim" });
    } catch (error) {
      console.error("Error processing claim:", error);
      return res.status(500).json({ message: `Failed to process claim: ${error}` });
    }
  });

  // Submit a signed transaction
  app.post("/api/submit-transaction", async (req: Request, res: Response) => {
    try {
      const result = signedTransactionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { signedTxn, isSequential, sequentialIndex, transactionId, approach } = result.data;
      
      if (!signedTxn) {
        return res.status(400).json({ message: "Signed transaction is required" });
      }
      
      let txStatus = 'pending';
      console.log(`Processing signed transaction in base64: ${signedTxn.slice(0, 20)}...`);
      const signedTxnBuffer = Buffer.from(signedTxn, 'base64');
      
      // Use the appropriate submit function based on the approach
      let txId;
      if (approach === 'app') {
        // Use the app-based approach
        txId = await submitTransaction(signedTxnBuffer);
      } else {
        // Use the escrow-based approach (default)
        txId = await submitSignedTransaction(signedTxnBuffer);
      }
      
      if (isSequential && sequentialIndex === 2) { // 2 represents the final USDC transfer transaction
        console.log(`All sequential transactions completed for transaction ID ${transactionId}. Updating status to 'funded'`);
        txStatus = 'funded';
        
        // In a production app, here we would update the database record with 'funded' status
        // Update logic would go here
      }
      
      return res.json({
        success: true,
        transactionId: txId,
        status: txStatus
      });
    } catch (error) {
      console.error("Error submitting signed transaction:", error);
      return res.status(500).json({ message: "Failed to submit transaction" });
    }
  });

  // New endpoint to complete the USDC opt-in and transfer after app creation
  app.post("/api/complete-funding", async (req: Request, res: Response) => {
    try {
      const result = completeFundingSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          success: false, 
          message: result.error.message 
        });
      }
      
      const { appId, appAddress, transactionId, senderAddress } = result.data;
      
      console.log(`Preparing opt-in and transfer for app ${appId} at ${appAddress}`);
      
      // 1. First, check if app exists (it should by now)
      try {
        const appInfo = await algodClient.getApplicationByID(appId).do();
        console.log("App exists, proceeding with opt-in and transfer");
      } catch (error) {
        console.error("App does not exist yet:", error);
        return res.status(400).json({ 
          success: false, 
          message: "App does not exist yet, please try again after app creation is confirmed" 
        });
      }
      
      // 2. Get the transaction from database to get the amount
      const transaction = await storage.getTransactionById(transactionId);
      if (!transaction) {
        return res.status(404).json({ 
          success: false, 
          message: "Transaction not found" 
        });
      }
      
      const amount = parseFloat(transaction.amount);
      
      // 3. Prepare the opt-in transaction (app calling itself)
      const suggestedParams = await algodClient.getTransactionParams().do();
      
      // App call to opt in to USDC
      const optInCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        appIndex: appId,
        suggestedParams: { ...suggestedParams },
        sender: senderAddress,
        appArgs: [new Uint8Array(Buffer.from("opt_in_to_asset"))],
        foreignAssets: [USDC_ASSET_ID]
      });
      
      // Asset transfer for opt-in (from app to app, 0 amount)
      const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: appAddress,
        receiver: appAddress,
        amount: 0,
        assetIndex: USDC_ASSET_ID,
        note: new Uint8Array(0),
        suggestedParams: { ...suggestedParams, flatFee: true, fee: BigInt(1000) }
      });
      
      // Group the opt-in transactions
      const optInGroup = [optInCallTxn, optInTxn];
      algosdk.assignGroupID(optInGroup);
      
      // 4. Prepare USDC transfer transaction (separate)
      const microAmount = Math.floor(amount * 1_000_000);
      const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: senderAddress,
        receiver: appAddress,
        amount: microAmount,
        assetIndex: USDC_ASSET_ID,
        note: new Uint8Array(0),
        suggestedParams: { ...suggestedParams, flatFee: true, fee: BigInt(1000) }
      });
      
      // Encode the transactions for the client
      const optInCallTxnBase64 = Buffer.from(algosdk.encodeUnsignedTransaction(optInCallTxn)).toString('base64');
      const optInTxnBase64 = Buffer.from(algosdk.encodeUnsignedTransaction(optInTxn)).toString('base64');
      const transferTxnBase64 = Buffer.from(algosdk.encodeUnsignedTransaction(transferTxn)).toString('base64');
      
      // Return transactions to the client for signing
      return res.json({
        success: true,
        optInCallTxn: optInCallTxnBase64,
        optInTxn: optInTxnBase64,
        transferTxn: transferTxnBase64,
        message: "Phase 2 transactions prepared successfully"
      });
      
    } catch (error) {
      console.error("Error preparing phase 2 transactions:", error);
      return res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : "Unknown error preparing phase 2 transactions"
      });
    }
  });

  // Handle atomic transaction groups
  app.post("/api/submit-atomic-group", async (req: Request, res: Response) => {
    try {
      const result = atomicTransactionGroupSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.message });
      }
      
      const { signedTxns, transactionId, approach } = result.data;
      
      if (!signedTxns || signedTxns.length === 0) {
        return res.status(400).json({ message: "Signed transactions are required" });
      }
      
      console.log(`Processing atomic group with ${signedTxns.length} transactions`);
      
      // Process and submit each transaction in the group
      let firstTxId: string = '';
      let success = true;
      let txStatus = 'pending';
      
      for (let i = 0; i < signedTxns.length; i++) {
        try {
          // Decode the base64 transaction
          const signedTxnBuffer = Buffer.from(signedTxns[i], 'base64');
          
          // Submit based on the transaction approach
          let txId: string;
          if (approach === 'app') {
            // Use the app-based approach
            txId = await submitTransaction(signedTxnBuffer);
          } else {
            // Use the escrow-based approach (default)
            txId = await submitSignedTransaction(signedTxnBuffer);
          }
          
          console.log(`Transaction ${i+1}/${signedTxns.length} submitted with ID: ${txId}`);
          
          // Store the first transaction ID as reference
          if (i === 0) {
            firstTxId = txId;
          }
          
          // If this is the final transaction in the group (e.g., the USDC transfer), 
          // mark the transaction as funded
          if (i === signedTxns.length - 1) {
            txStatus = 'funded';
          }
        } catch (error) {
          console.error(`Error submitting transaction ${i+1}:`, error);
          success = false;
          // Continue processing other transactions
        }
      }
      
      // If we have a transaction ID from the database, update it
      if (transactionId && firstTxId && success) {
        const transaction = await storage.getTransactionById(transactionId);
        
        if (transaction) {
          // Mark the transaction as funded
          transaction.transactionId = firstTxId;
          console.log(`Updated transaction ${transactionId} with Algorand transaction ID ${firstTxId}`);
        }
      }
      
      return res.json({ 
        success, 
        transactionId: firstTxId,
        status: txStatus,
        message: success ? "All transactions submitted successfully" : "Some transactions failed to submit"
      });
    } catch (error) {
      console.error('Error submitting atomic transaction group:', error);
      return res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : "Unknown error submitting transaction group" 
      });
    }
  });

  // Create a new transaction (send USDC)
  app.post("/api/send", async (req: Request, res: Response) => {
    try {
      // Safe stringify to handle BigInt
      try {
        console.log("Send API received request:", JSON.stringify(req.body, (key, value) => 
          typeof value === 'bigint' ? value.toString() : value
        ));
      } catch (e) {
        console.log("Send API received request (stringification failed):", req.body);
      }
      
      const result = sendUsdcSchema.safeParse(req.body);
      if (!result.success) {
        console.error("Validation error:", result.error);
        return res.status(400).json({ message: result.error.message });
      }
      
      const { senderAddress, recipientEmail, amount, note, hasDeadline } = result.data;
      const roundedAmount = Math.round(parseFloat(amount) * 100) / 100; // Round to 2 decimal places

      console.log("Creating claim app for sender:", senderAddress);
      
      // Create a claim app
      let claimApp;
      try {
        claimApp = await createClaimApp(senderAddress);
        console.log("Claim app created successfully:", claimApp);
      } catch (error) {
        console.error("Failed to create claim app:", error);
        return res.status(500).json({ message: "Failed to create claim app" });
      }
      
      if (!claimApp || !claimApp.appAddress) {
        console.error("Invalid claim app result - missing app address");
        return res.status(500).json({ message: "Failed to get valid app address" });
      }
      
      // Generate a unique claim token (or use the one from createClaimApp)
      const claimToken = claimApp.claimToken;
      
      // Expiration date for deadline option (14 days from now)
      const expirationDate = hasDeadline 
        ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        : null;
            
      // Create a transaction record in our database
      const transaction = await storage.createTransaction({
        senderAddress,
        recipientEmail,
        amount: roundedAmount.toString(),
        note: note || "",
        claimToken,
        appAddress: claimApp.appAddress, // Use app address 
        appId: claimApp.appId, // Store the app ID
        approach: "app", // Mark as using the app-based approach
      });
      
      try {
        const txnsBase64: string[] = [];
        const allTxnsBase64: string[] = [];
        
        // Create the application creation transaction
        const onCompletionValue = algosdk.OnApplicationComplete.NoOpOC;
        const localInts = 0;
        const localBytes = 0;
        const globalInts = 1; // For storing amount
        const globalBytes = 2; // For storing sender and recipient
        const suggestedParams = await algodClient.getTransactionParams().do();
        
        // Compile the TEAL program again - needed for creating app transaction
        const approvalProgramTemplate = `#pragma version 6
// Check if this is an asset transfer (claim or reclaim)
txn TypeEnum
int 4 // AssetTransfer
==
bz reject

// Check if this is for USDC asset
txn XferAsset
int ${USDC_ASSET_ID} // USDC Asset ID
==
bz reject

// Check if sender is either original sender (reclaim) or recipient (claim)
txn Sender
addr ${senderAddress} // Original sender
==
bnz approve // If sender is original sender, approve (reclaim)

// Otherwise, check if sender is the recipient (claim)
txn Sender
addr ${senderAddress} // Initial recipient (same as sender for now)
==
bz reject // If not recipient, reject

approve:
int 1
return

reject:
int 0
return
`;
        
        // Compile the approval program
        const compiledApprovalProgram = await compileProgram(approvalProgramTemplate);
        
        // Use a simple clear program that always succeeds
        const clearProgramSource = "#pragma version 6\nint 1\nreturn";
        const compiledClearProgram = await compileProgram(clearProgramSource);
        
        // Create the application creation transaction for the user to sign
        const appCreateTxn = algosdk.makeApplicationCreateTxnFromObject({
          sender: senderAddress,
          approvalProgram: compiledApprovalProgram,
          clearProgram: compiledClearProgram,
          numLocalInts: localInts,
          numLocalByteSlices: localBytes,
          numGlobalInts: globalInts,
          numGlobalByteSlices: globalBytes,
          suggestedParams,
          onComplete: onCompletionValue
        });
        
        // Prepare the app funding transactions
        const appFundingTxns = await prepareAppFundingTransactions(
          senderAddress,
          claimApp.appId,
          claimApp.appAddress,
          roundedAmount
        );
        
        // Create separate app creation and funding transactions
        // We'll handle them as separate transactions - not as a group
        // This is critical because the Algorand SDK validation can sometimes
        // reject atomic groups with app creation transactions
        
        // Prepare transactions individually
        const appCreateTxnEncoded = algosdk.encodeUnsignedTransaction(appCreateTxn);
        const appFundingTxnEncoded = appFundingTxns.appFundingTxn;
        
        // Use individual transactions - not grouped
        const unsignedTxns = [
          appCreateTxnEncoded,
          appFundingTxnEncoded
        ];
        
        // For the opt-in and transfer, we'll handle those in a separate transaction group
        // after the app is created and funded
        
        // Store the appId and appAddress in the database for later use
        transaction.appId = claimApp.appId;
        transaction.appAddress = claimApp.appAddress;
        
        // Convert transactions to base64 for sending to the frontend
        try {
          console.log(`Encoding ${unsignedTxns.length} unsigned transactions`);
          unsignedTxns.forEach((txn: Uint8Array, i: number) => {
            txnsBase64.push(Buffer.from(txn).toString('base64'));
            console.log(`Encoded unsigned transaction ${i+1}`);
          });
          
          // For the first phase, we only need to create the app and fund it
          // Phase 1: Create and fund the app as individual transactions
          const allTransactions = unsignedTxns;
          
          // Phase 2 will be done after app is created:
          // - Opt-in to USDC
          // - Transfer USDC 
          // This will happen in a second transaction that will be initiated
          // after confirming that the app was created successfully
          
          // Convert all transactions in the group (including pre-signed ones)
          if (allTransactions) {
            console.log(`Encoding ${allTransactions.length} total transactions including pre-signed`);
            allTransactions.forEach((txn: Uint8Array, i: number) => {
              allTxnsBase64.push(Buffer.from(txn).toString('base64'));
              console.log(`Encoded all-transaction ${i+1}`);
            });
          }
        } catch (error) {
          console.error("Error encoding transactions:", error);
          return res.status(500).json({ message: "Failed to encode transactions" });
        }
        
        // Create transaction parameters for the frontend
        const txParams = {
          txnsBase64,            // Transactions that need signing
          allTxnsBase64,         // All transactions including pre-signed ones
          appAddress: claimApp.appAddress,
          appId: claimApp.appId,
          transactionId: transaction.id
        };
        
        // Attempted to send the claim email in background without delaying response
        const appDomain = getAppDomain(req);
        sendClaimEmail({
          recipientEmail,
          amount: roundedAmount.toString(),
          note: note || "",
          senderAddress,
          claimToken,
          appDomain
        }).catch(emailError => {
          console.error("Email sending failed:", emailError);
          // We don't return an error here because the transaction is still valid
          // and the user can manually share the claim link
        });

        return res.json({
          success: true,
          appAddress: claimApp.appAddress,
          appId: claimApp.appId,
          claimLink: `${appDomain}/claim/${claimToken}`,
          claimToken,
          transactions: txParams,
          transactionId: transaction.id
        });
      } catch (error) {
        console.error("Error preparing transactions:", error);
        return res.status(500).json({ message: "Failed to prepare app funding transactions" });
      }
    } catch (error) {
      console.error("Send API error:", error);
      return res.status(500).json({ message: "Failed to create claim transaction" });
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
          approach: transaction.approach || "logicsig", // Default to logicsig for backward compatibility
          appId: transaction.appId,  // Will be undefined for logicsig approach
          appAddress: transaction.appAddress, // Will be undefined for logicsig approach
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