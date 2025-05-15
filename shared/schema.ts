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
  // Fields for the old logicsig approach - keeping for backward compatibility
  smartContractAddress: text("smart_contract_address"),
  compiledTealProgram: text("compiled_teal_program"),
  tealSource: text("teal_source"),
  tealSalt: text("teal_salt"),
  // New fields for the app-based approach
  appId: integer("app_id"),
  appAddress: text("app_address"),
  // Common fields
  claimToken: text("claim_token").notNull().unique(),
  claimed: boolean("claimed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  claimedAt: timestamp("claimed_at"),
  claimedByAddress: text("claimed_by_address"),
  // Track the approach used for this transaction
  approach: text("approach").default("logicsig"), // 'logicsig' or 'app'
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
  // Old LogicSig approach fields
  smartContractAddress: true,
  compiledTealProgram: true,
  tealSource: true,
  tealSalt: true,
  // New app-based approach fields
  appId: true,
  appAddress: true,
  // Common fields
  claimToken: true,
  approach: true,
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

export const signedTransactionSchema = z.object({
  signedTxn: z.string().min(1, "Signed transaction is required"),
  transactionId: z.number().int().positive(),
  // Optional fields for sequential transaction processing
  isSequential: z.boolean().optional(),
  sequentialIndex: z.number().int().min(0).optional(),
  approach: z.string().optional(),
});

export const atomicTransactionGroupSchema = z.object({
  signedTxns: z.array(z.string().min(1, "Each transaction must be a non-empty string")),
  transactionId: z.number().int().positive(),
  approach: z.string().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type SendUsdcInput = z.infer<typeof sendUsdcSchema>;
export type ClaimUsdcInput = z.infer<typeof claimUsdcSchema>;
export type RegenerateClaimLinkInput = z.infer<typeof regenerateClaimLinkSchema>;
export type ReclaimUsdcInput = z.infer<typeof reclaimUsdcSchema>;
export type SignedTransactionInput = z.infer<typeof signedTransactionSchema>;
export type AtomicTransactionGroupInput = z.infer<typeof atomicTransactionGroupSchema>;
