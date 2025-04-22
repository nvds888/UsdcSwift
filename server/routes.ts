import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import {
  sendUsdcSchema,
  claimUsdcSchema,
  regenerateClaimLinkSchema,
  reclaimUsdcSchema,
} from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { 
  createEscrowAccount, 
  fundEscrowAccount, 
  claimFromEscrow,
  reclaimFromEscrow,
  getUserBalance
} from "./algorand";
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

  // Create a new transaction (send USDC)
  app.post("/api/send", async (req: Request, res: Response) => {
    try {
      const validatedData = sendUsdcSchema.parse(req.body);
      
      // Create escrow account
      const { escrowAddress, claimToken, logicSignature } = await createEscrowAccount(
        validatedData.senderAddress
      );
      
      // Store transaction in database
      const transaction = await storage.createTransaction({
        senderAddress: validatedData.senderAddress,
        recipientEmail: validatedData.recipientEmail,
        amount: validatedData.amount,
        note: validatedData.note,
        smartContractAddress: escrowAddress,
        claimToken: claimToken,
      });
      
      // Generate transaction parameters for the frontend to sign
      // The frontend will handle the actual transaction signing and submission
      const txParams = {
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
      
      // Generate transaction parameters for the frontend to sign
      // In a production app, we would recreate the escrow logic signature here
      // and return the transaction parameters for the frontend to sign
      const txParams = {
        escrowAddress: transaction.smartContractAddress,
        recipientAddress: validatedData.recipientAddress,
        claimToken: validatedData.claimToken,
        amount: parseFloat(transaction.amount)
      };
      
      // For now, generate a fake transaction ID
      const txId = `TXID-${uuidv4()}`;
      
      // Update transaction as claimed
      const updatedTransaction = await storage.markTransactionAsClaimed(
        transaction.id,
        validatedData.recipientAddress,
        txId
      );
      
      return res.json({
        ...updatedTransaction,
        txParams
      });
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
      
      // Generate transaction parameters for the frontend to sign
      // In a production app, we would recreate the escrow logic signature here
      // and return the transaction parameters for the frontend to sign
      const txParams = {
        escrowAddress: transaction.smartContractAddress,
        senderAddress: validatedData.senderAddress,
        amount: parseFloat(transaction.amount)
      };
      
      // For now, generate a fake transaction ID
      const txId = `RECLAIM-${uuidv4()}`;
      
      // Update transaction as claimed by sender (reclaimed)
      const updatedTransaction = await storage.markTransactionAsClaimed(
        transaction.id,
        validatedData.senderAddress,
        txId
      );
      
      return res.json({
        ...updatedTransaction,
        txParams
      });
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
