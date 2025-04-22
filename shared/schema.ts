import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  senderAddress: text("sender_address").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  amount: text("amount").notNull(), // Store as string to maintain precision
  note: text("note"),
  smartContractAddress: text("smart_contract_address").notNull(),
  claimToken: text("claim_token").notNull().unique(),
  claimed: boolean("claimed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  claimedAt: timestamp("claimed_at"),
  claimedByAddress: text("claimed_by_address"),
  transactionId: text("transaction_id"),
  expiresAt: timestamp("expires_at"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).pick({
  senderAddress: true,
  recipientEmail: true,
  amount: true,
  note: true,
  smartContractAddress: true,
  claimToken: true,
});

export const sendUsdcSchema = z.object({
  recipientEmail: z.string().email("Valid email address is required"),
  amount: z.string().min(1, "Amount is required"),
  note: z.string().optional(),
  senderAddress: z.string().min(1, "Sender address is required"),
});

export const claimUsdcSchema = z.object({
  claimToken: z.string().min(1, "Claim token is required"),
  recipientAddress: z.string().min(1, "Recipient address is required"),
});

export const regenerateClaimLinkSchema = z.object({
  transactionId: z.number().int().positive(),
  senderAddress: z.string().min(1, "Sender address is required"),
});

export const reclaimUsdcSchema = z.object({
  transactionId: z.number().int().positive(),
  senderAddress: z.string().min(1, "Sender address is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type SendUsdcInput = z.infer<typeof sendUsdcSchema>;
export type ClaimUsdcInput = z.infer<typeof claimUsdcSchema>;
export type RegenerateClaimLinkInput = z.infer<typeof regenerateClaimLinkSchema>;
export type ReclaimUsdcInput = z.infer<typeof reclaimUsdcSchema>;
