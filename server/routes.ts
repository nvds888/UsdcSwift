import { Express, Request, Response, NextFunction } from "express";
import { Server } from "http";
import { v4 as uuidv4 } from "uuid";
import { 
  sendUsdcSchema, 
  claimUsdcSchema, 
  regenerateClaimLinkSchema, 
  reclaimUsdcSchema, 
  signedTransactionSchema,
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
  getUsdcBalance
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
        // Generate transactions for funding the app
        const unsignedTxns: Uint8Array[] = [];
        const txnsBase64: string[] = [];
        const allTxnsBase64: string[] = [];
        
        // Prepare the app funding transactions
        const appFundingTxns = await prepareAppFundingTransactions(
          senderAddress,
          claimApp.appId,
          claimApp.appAddress,
          roundedAmount
        );
        
        // No need to sign the opt-in transaction as it's an app call
        // The sender will sign all transactions in the atomic group
        
        // Add all transactions that need signing by the sender
        unsignedTxns.push(appFundingTxns.appFundingTxn);  // Fund app with ALGO
        unsignedTxns.push(appFundingTxns.usdcOptInTxn);   // App call to opt in to USDC
        unsignedTxns.push(appFundingTxns.usdcTransferTxn); // Transfer USDC to app
        
        // Convert transactions to base64 for sending to the frontend
        try {
          console.log(`Encoding ${unsignedTxns.length} unsigned transactions`);
          unsignedTxns.forEach((txn: Uint8Array, i: number) => {
            txnsBase64.push(Buffer.from(txn).toString('base64'));
            console.log(`Encoded unsigned transaction ${i+1}`);
          });
          
          // Include all transactions in the atomic group
          const allTransactions = [
            appFundingTxns.appFundingTxn,
            appFundingTxns.usdcOptInTxn,
            appFundingTxns.usdcTransferTxn
          ];
          
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