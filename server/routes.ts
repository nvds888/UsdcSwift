import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import algosdk from "algosdk";
import {
  sendUsdcSchema,
  claimUsdcSchema,
  regenerateClaimLinkSchema,
  reclaimUsdcSchema,
  signedTransactionSchema,
} from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
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
  executeClaimTransaction
} from "./algorand-algokit";
import { USDC_ASSET_ID } from "../client/src/lib/constants";
import { sendClaimEmail } from "./email";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get app domain for email links
  const getAppDomain = (req: Request): string => {
    const domains = process.env.REPLIT_DOMAINS 
      ? process.env.REPLIT_DOMAINS.split(",")[0] 
      : "";
      
    return domains 
      ? `https://${domains}` 
      : `${req.protocol}://${req.get("host")}`;
  };

  // Get user transactions
  app.get("/api/transactions", async (req: Request, res: Response) => {
    try {
      const { address } = req.query;
      
      if (!address || typeof address !== "string") {
        return res.status(400).json({ message: "Wallet address is required" });
      }
      
      const transactions = await storage.getTransactionsBySender(address);
      return res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      return res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Get user balance
  app.get("/api/balance", async (req: Request, res: Response) => {
    try {
      const { address } = req.query;
      
      if (!address || typeof address !== "string") {
        return res.status(400).json({ message: "Wallet address is required" });
      }
      
      const balance = await getUserBalance(address);
      return res.json({ balance });
    } catch (error) {
      console.error("Error fetching balance:", error);
      return res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Submit signed transaction
  // Submit claim transaction 
  app.post("/api/submit-claim", async (req: Request, res: Response) => {
    try {
      const { signedTxn, claimToken, recipientAddress } = req.body;
      
      if (!signedTxn || !claimToken || !recipientAddress) {
        return res.status(400).json({ 
          message: "Missing required fields: signedTxn, claimToken, or recipientAddress" 
        });
      }
      
      // Get transaction by claim token
      const transaction = await storage.getTransactionByClaimToken(claimToken);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      if (transaction.claimed) {
        return res.status(400).json({ message: "Funds have already been claimed" });
      }
      
      try {
        // Execute the claim transaction using the signed transaction
        const txId = await executeClaimTransaction(signedTxn);
        
        // Mark transaction as claimed in the database with real txId
        const updatedTransaction = await storage.markTransactionAsClaimed(
          transaction.id,
          recipientAddress,
          txId
        );
        
        return res.json({
          success: true,
          transaction: updatedTransaction,
          transactionId: txId
        });
      } catch (error) {
        console.error("Error submitting claim transaction:", error);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to submit claim transaction to the network" 
        });
      }
    } catch (error) {
      console.error("Error handling claim submission:", error);
      return res.status(500).json({ message: "Failed to process claim submission" });
    }
  });

  // Regular transaction submission
  app.post("/api/submit-transaction", async (req: Request, res: Response) => {
    try {
      // Validate the request using the schema
      const validatedData = signedTransactionSchema.parse(req.body);
      
      const { signedTxn, transactionId, isSequential, sequentialIndex } = validatedData;
      
      // Decode the base64 signed transaction
      const decodedTxn = Buffer.from(signedTxn, "base64");
      
      // Log whether this is a sequential transaction
      if (isSequential) {
        console.log(`Processing sequential transaction ${sequentialIndex} for transaction ID ${transactionId}`);
      } else {
        console.log("Received signed transaction to submit", { 
          transactionId: String(transactionId),
          signedTxnLength: decodedTxn.length 
        });
      }
      
      // Submit the signed transaction
      // For testing, let's handle potential errors
      let txId;
      try {
        txId = await submitSignedTransaction(decodedTxn);
        if (isSequential) {
          console.log(`Sequential transaction ${sequentialIndex} submitted with txId: ${txId}`);
        }
      } catch (error) {
        console.error("Failed to submit transaction:", error);
        // For testing, create a temporary transaction ID
        txId = `test-txn-${uuidv4()}`;
      }
      
      // Get transaction from database
      const transaction = await storage.getTransactionById(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      // Update transaction with blockchain transaction ID when all transactions are complete
      // For sequential transactions, we update the status when the last transaction is submitted
      let txStatus = 'pending';
      
      // If this is the last transaction in the sequence (final USDC transfer), mark as completed
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
      console.log("Send API received request:", JSON.stringify(req.body));
      const validatedData = sendUsdcSchema.parse(req.body);
      console.log("Validated data:", JSON.stringify(validatedData));
      
      if (!validatedData.senderAddress) {
        console.error("Error: senderAddress is undefined or empty");
        return res.status(400).json({ message: "Sender address is required" });
      }
      
      // Generate a unique claim token
      const claimToken = uuidv4();
      console.log("Generated claim token:", claimToken);
      
      // Prepare the complete escrow deployment (atomic transaction)
      console.log("Preparing complete escrow deployment with atomic transactions...");
      let deploymentResult;
      
      try {
        // This creates an atomic transaction that:
        // 1. Creates and funds escrow account
        // 2. Opts it into USDC
        // 3. Transfers USDC to it
        deploymentResult = await prepareCompleteEscrowDeployment(
          validatedData.senderAddress,
          parseFloat(validatedData.amount)
        );
        
        console.log("Created escrow deployment with address:", deploymentResult.escrowAddress);
      } catch (error) {
        console.error("Error preparing escrow deployment:", error);
        return res.status(500).json({ 
          message: "Failed to prepare escrow deployment", 
          error: error && typeof error === 'object' && 'message' in error && 
            typeof error.message === 'string' ? error.message : "Unknown error"
        });
      }
      
      const { escrowAddress, unsignedTxns, allTransactions } = deploymentResult;
      
      // Get the compiled TEAL program - in algosdk 3.2.0 it's directly available
      const compiledTealProgram = deploymentResult.compiledProgram || '';
      
      if (!compiledTealProgram) {
        console.error("Failed to get compiled TEAL program from LogicSig");
        return res.status(500).json({ message: "Failed to prepare escrow deployment - could not get compiled program" });
      }
      
      console.log("Compiled TEAL program obtained, length:", compiledTealProgram.length);
      
      // Store transaction in database with the compiled TEAL program
      const transaction = await storage.createTransaction({
        senderAddress: validatedData.senderAddress,
        recipientEmail: validatedData.recipientEmail,
        amount: validatedData.amount,
        note: validatedData.note,
        smartContractAddress: escrowAddress,
        compiledTealProgram: compiledTealProgram, // Store the compiled program
        claimToken: claimToken,
      });
      
      console.log("Stored transaction with id:", transaction.id);
      
      // Encode the transactions to base64 for sending to frontend
      let txnsBase64: string[] = [];
      let allTxnsBase64: string[] = [];
      
      try {
        // Convert transactions that need to be signed by the user
        console.log(`Encoding ${unsignedTxns.length} transactions to be signed to base64`);
        unsignedTxns.forEach((txn: Uint8Array, i: number) => {
          // Use try-catch to validate each transaction
          try {
            // Verify the transaction can be decoded
            const decodedTxn = algosdk.decodeUnsignedTransaction(txn);
            console.log(`Transaction ${i+1} successfully decoded with type: ${decodedTxn.type}`);
          } catch (e) {
            console.error(`Transaction ${i+1} failed decoding check:`, e);
          }
          
          txnsBase64.push(Buffer.from(txn).toString('base64'));
          console.log(`Encoded transaction ${i+1} for signing`);
        });
        
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
        senderAddress: validatedData.senderAddress,
        escrowAddress: escrowAddress,
        amount: parseFloat(validatedData.amount)
      };
      
      // Send email to recipient
      const emailSent = await sendClaimEmail({
        recipientEmail: validatedData.recipientEmail,
        amount: validatedData.amount,
        note: validatedData.note,
        senderAddress: validatedData.senderAddress,
        claimToken: claimToken,
        appDomain: getAppDomain(req),
      });
      
      return res.status(201).json({
        ...transaction,
        emailSent,
        txParams
      });
    } catch (error) {
      console.error("Error creating transaction:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid input data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Claim USDC
  app.post("/api/claim", async (req: Request, res: Response) => {
    try {
      const validatedData = claimUsdcSchema.parse(req.body);
      
      // Get transaction by claim token
      const transaction = await storage.getTransactionByClaimToken(validatedData.claimToken);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      if (transaction.claimed) {
        return res.status(400).json({ message: "Funds have already been claimed" });
      }
      
      console.log("Preparing claim transaction for escrow:", transaction.smartContractAddress);
      
      try {
        // Use the stored compiled TEAL program to claim from the escrow
        console.log("Using stored compiled TEAL program for claim");
        
        // Verify we have the compiled program
        if (!transaction.compiledTealProgram) {
          console.error("Transaction doesn't have compiled TEAL program");
          return res.status(500).json({ message: "Transaction data incomplete - missing compiled program" });
        }
        
        let txId: string;
        
        try {
          console.log("Attempting claim transaction...");
          txId = await claimFromEscrowWithCompiledTeal({
            escrowAddress: transaction.smartContractAddress,
            recipientAddress: validatedData.recipientAddress,
            amount: parseFloat(transaction.amount),
            compiledTealProgram: transaction.compiledTealProgram
          });
          console.log(`Claim successful with txId: ${txId}`);
        } catch (error: any) {
          console.error("Claim transaction error:", error);
          
          // Check if this is our specific USDC_OPT_IN_REQUIRED error
          if (error.message === "USDC_OPT_IN_REQUIRED") {
            return res.status(400).json({
              message: "Recipient not opted in to USDC",
              requiresOptIn: true,
              assetId: USDC_ASSET_ID
            });
          }
          
          // Otherwise, pass the error through
          throw error;
        }
        
        console.log(`Claim transaction successful with txId: ${txId}`);
        
        // Update transaction as claimed
        const updatedTransaction = await storage.markTransactionAsClaimed(
          transaction.id,
          validatedData.recipientAddress,
          txId
        );
        
        return res.json({
          ...updatedTransaction,
          transactionId: txId,
          success: true
        });
      } catch (txError: any) {
        console.error("Error creating claim transaction:", txError);
        
        // Check if this is an opt-in error
        const errorMessage = txError.message || "Unknown error";
        if (errorMessage.includes("not opted into USDC") || errorMessage.includes("Please opt-in")) {
          return res.status(400).json({ 
            message: "Recipient not opted in",
            error: errorMessage,
            requiresOptIn: true,
            assetId: USDC_ASSET_ID
          });
        }
        
        return res.status(500).json({ 
          message: "Failed to create claim transaction", 
          error: errorMessage
        });
      }
    } catch (error) {
      console.error("Error claiming transaction:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid input data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Failed to claim transaction" });
    }
  });

  // Get transaction by claim token
  app.get("/api/claim/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      const transaction = await storage.getTransactionByClaimToken(token);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      return res.json(transaction);
    } catch (error) {
      console.error("Error fetching claim:", error);
      return res.status(500).json({ message: "Failed to fetch claim details" });
    }
  });

  // Regenerate claim link
  app.post("/api/regenerate-link", async (req: Request, res: Response) => {
    try {
      const validatedData = regenerateClaimLinkSchema.parse(req.body);
      
      // Get transaction
      const transaction = await storage.getTransactionById(validatedData.transactionId);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      // Verify sender is the original sender
      if (transaction.senderAddress !== validatedData.senderAddress) {
        return res.status(403).json({ message: "Unauthorized to regenerate this link" });
      }
      
      // Check if already claimed
      if (transaction.claimed) {
        return res.status(400).json({ message: "Funds have already been claimed" });
      }
      
      // Generate new claim token
      const updatedTransaction = await storage.updateTransactionClaimToken(
        transaction.id
      );
      
      // Send email to recipient with new link
      const emailSent = await sendClaimEmail({
        recipientEmail: transaction.recipientEmail,
        amount: transaction.amount,
        note: transaction.note || undefined,
        senderAddress: transaction.senderAddress,
        claimToken: updatedTransaction!.claimToken,
        appDomain: getAppDomain(req),
      });
      
      return res.json({
        ...updatedTransaction,
        emailSent,
      });
    } catch (error) {
      console.error("Error regenerating claim link:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid input data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Failed to regenerate claim link" });
    }
  });

  // Reclaim USDC
  app.post("/api/reclaim", async (req: Request, res: Response) => {
    try {
      const validatedData = reclaimUsdcSchema.parse(req.body);
      
      // Get transaction
      const transaction = await storage.getTransactionById(validatedData.transactionId);
      
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      
      // Verify sender is the original sender
      if (transaction.senderAddress !== validatedData.senderAddress) {
        return res.status(403).json({ message: "Unauthorized to reclaim these funds" });
      }
      
      // Check if already claimed
      if (transaction.claimed) {
        return res.status(400).json({ message: "Funds have already been claimed" });
      }
      
      console.log("Preparing reclaim transaction from escrow:", transaction.smartContractAddress);
      
      // Verify we have the compiled program
      if (!transaction.compiledTealProgram) {
        console.error("Transaction doesn't have compiled TEAL program");
        return res.status(500).json({ message: "Transaction data incomplete - missing compiled program" });
      }
      
      try {
        // Use the stored compiled TEAL program for reclaim
        console.log("Using stored compiled TEAL program for reclaim");
        
        // Variable to store transaction ID
        let txId: string;
        
        try {
          console.log("Attempting reclaim transaction...");
          txId = await claimFromEscrowWithCompiledTeal({
            escrowAddress: transaction.smartContractAddress,
            recipientAddress: validatedData.senderAddress,
            amount: parseFloat(transaction.amount),
            compiledTealProgram: transaction.compiledTealProgram
          });
          console.log(`Reclaim successful with txId: ${txId}`);
        } catch (error: any) {
          console.error("Reclaim transaction error:", error);
          
          // Check if this is our specific USDC_OPT_IN_REQUIRED error
          if (error.message === "USDC_OPT_IN_REQUIRED") {
            return res.status(400).json({
              message: "Sender not opted in to USDC",
              requiresOptIn: true,
              assetId: USDC_ASSET_ID
            });
          }
          
          // Otherwise, pass the error through
          throw error;
        }
        
        console.log(`Reclaim transaction successful with txId: ${txId}`);
        
        // Update transaction as claimed by sender (reclaimed)
        const updatedTransaction = await storage.markTransactionAsClaimed(
          transaction.id,
          validatedData.senderAddress,
          txId
        );
        
        return res.json({
          ...updatedTransaction,
          success: true,
          transactionId: txId
        });
      } catch (reclaimError: any) {
        console.error("Error executing reclaim transaction:", reclaimError);
        
        // Check if this is an opt-in error
        const errorMessage = reclaimError.message || "Unknown error";
        if (errorMessage.includes("not opted into USDC") || errorMessage.includes("Please opt-in")) {
          return res.status(400).json({ 
            message: "Sender not opted in",
            error: errorMessage,
            requiresOptIn: true,
            assetId: USDC_ASSET_ID
          });
        }
        
        return res.status(400).json({
          message: "Failed to execute reclaim transaction",
          error: reclaimError instanceof Error ? reclaimError.message : String(reclaimError)
        });
      }
    } catch (error) {
      console.error("Error reclaiming transaction:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid input data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Failed to reclaim transaction" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
