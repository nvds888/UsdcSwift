import {
  users,
  type User,
  type InsertUser,
  transactions,
  type Transaction,
  type InsertTransaction
} from "@shared/schema";
import { v4 as uuidv4 } from "uuid";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getTransactionById(id: number): Promise<Transaction | undefined>;
  getTransactionByClaimToken(claimToken: string): Promise<Transaction | undefined>;
  getTransactionsBySender(senderAddress: string): Promise<Transaction[]>;
  markTransactionAsClaimed(id: number, claimedByAddress: string, transactionId: string): Promise<Transaction | undefined>;
  updateTransactionClaimToken(id: number): Promise<Transaction | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private transactions: Map<number, Transaction>;
  private userIdCounter: number;
  private transactionIdCounter: number;

  constructor() {
    this.users = new Map();
    this.transactions = new Map();
    this.userIdCounter = 1;
    this.transactionIdCounter = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const id = this.transactionIdCounter++;
    const newTransaction: Transaction = {
      ...transaction,
      id,
      claimed: false,
      createdAt: new Date(),
      claimedAt: null,
      claimedByAddress: null,
      transactionId: null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days expiry
    };
    this.transactions.set(id, newTransaction);
    return newTransaction;
  }

  async getTransactionById(id: number): Promise<Transaction | undefined> {
    return this.transactions.get(id);
  }

  async getTransactionByClaimToken(claimToken: string): Promise<Transaction | undefined> {
    return Array.from(this.transactions.values()).find(
      (transaction) => transaction.claimToken === claimToken,
    );
  }

  async getTransactionsBySender(senderAddress: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (transaction) => transaction.senderAddress === senderAddress,
    );
  }

  async markTransactionAsClaimed(id: number, claimedByAddress: string, transactionId: string): Promise<Transaction | undefined> {
    const transaction = this.transactions.get(id);
    
    if (!transaction) {
      return undefined;
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      claimed: true,
      claimedAt: new Date(),
      claimedByAddress,
      transactionId,
    };

    this.transactions.set(id, updatedTransaction);
    return updatedTransaction;
  }

  async updateTransactionClaimToken(id: number): Promise<Transaction | undefined> {
    const transaction = this.transactions.get(id);
    
    if (!transaction) {
      return undefined;
    }

    const updatedTransaction: Transaction = {
      ...transaction,
      claimToken: uuidv4(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Reset expiry to 30 days
    };

    this.transactions.set(id, updatedTransaction);
    return updatedTransaction;
  }
}

export const storage = new MemStorage();
