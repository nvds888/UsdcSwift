export interface Transaction {
  id: number;
  senderAddress: string;
  recipientEmail: string;
  amount: string;
  note?: string;
  smartContractAddress: string;
  claimToken: string;
  claimed: boolean;
  createdAt: string;
  claimedAt?: string;
  claimedByAddress?: string;
  transactionId?: string;
  expiresAt?: string;
}

export interface SendUsdcParams {
  recipientEmail: string;
  amount: string;
  note?: string;
  senderAddress: string;
}

export interface ClaimUsdcParams {
  claimToken: string;
  recipientAddress: string;
}

export interface RegenerateLinkParams {
  transactionId: number;
  senderAddress: string;
}

export interface ReclaimUsdcParams {
  transactionId: number;
  senderAddress: string;
}

export interface TransactionParams {
  senderAddress?: string;
  escrowAddress: string;
  recipientAddress?: string;
  amount: number;
  claimToken?: string;
}

export interface TransactionResponse extends Transaction {
  emailSent: boolean;
  txParams?: TransactionParams;
}

export interface WalletAccount {
  address: string;
  name?: string;
}

export enum TransactionStatus {
  PENDING = "pending",
  CLAIMED = "claimed",
  EXPIRED = "expired"
}

export interface ClaimInfo {
  senderAddress: string;
  amount: string;
  note?: string;
  claimed: boolean;
  createdAt: string;
}
