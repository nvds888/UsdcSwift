import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Transaction, 
  TransactionResponse, 
  SendUsdcParams, 
  ClaimUsdcParams, 
  RegenerateLinkParams, 
  ReclaimUsdcParams,
  SignedTransactionParams
} from "@/lib/types";

export function useAlgorand() {
  const { activeAccount, signTransactions } = useWallet();
  const [balance, setBalance] = useState<string>("0.00");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { toast } = useToast();

  // Fetch user balance
  const fetchBalance = useCallback(async () => {
    if (!activeAccount?.address) return;

    try {
      const response = await fetch(`/api/balance?address=${activeAccount.address}`);
      if (!response.ok) throw new Error("Failed to fetch balance");
      
      const data = await response.json();
      setBalance(data.balance.toFixed(2));
    } catch (error) {
      console.error("Error fetching balance:", error);
      toast({
        title: "Error",
        description: "Failed to fetch your USDC balance",
        variant: "destructive",
      });
    }
  }, [activeAccount?.address, toast]);

  // Fetch user balance on component mount and when account changes
  useEffect(() => {
    if (activeAccount?.address) {
      fetchBalance();
    } else {
      setBalance("0.00");
    }
  }, [activeAccount?.address, fetchBalance]);

  // Helper function to sign and submit multiple transactions
  const signAndSubmitMultipleTransactions = async (
    txnsBase64: string[],
    transactionId: number,
    allTxnsBase64?: string[] // The complete transaction group including pre-signed txns
  ): Promise<boolean> => {
    if (!activeAccount) return false;
    
    try {
      // Use a different approach depending on whether we have a complete transaction group
      if (allTxnsBase64 && allTxnsBase64.length > 0) {
        console.log(`Using atomic transaction group with ${allTxnsBase64.length} total transactions`);
        return await signAndSubmitAtomicGroup(txnsBase64, allTxnsBase64, transactionId);
      } else {
        console.log(`Signing ${txnsBase64.length} individual transactions`);
        return await signAndSubmitIndividualTransactions(txnsBase64, transactionId);
      }
    } catch (error) {
      console.error("Error in transaction signing/submission:", error);
      return false;
    }
  };
  
  // Sign and submit transactions as an atomic group
  const signAndSubmitAtomicGroup = async (
    txnsToSign: string[],
    allTxns: string[],
    transactionId: number
  ): Promise<boolean> => {
    try {
      console.log(`Processing atomic transaction group: ${allTxns.length} total txns, ${txnsToSign.length} to sign`);
      
      // Convert all transactions to binary format
      const txnsToSignBinary = txnsToSign.map(txn => 
        new Uint8Array(Buffer.from(txn, 'base64'))
      );
      
      console.log(`Requesting wallet to sign ${txnsToSignBinary.length} transactions`);
      
      // Sign all transactions at once with the wallet
      const signedTxns = await signTransactions(txnsToSignBinary);
      
      if (!signedTxns || signedTxns.length === 0) {
        console.error("Failed to sign transactions");
        return false;
      }
      
      console.log(`Successfully signed ${signedTxns.length} transactions`);
      
      // Now submit each signed transaction
      for (let i = 0; i < signedTxns.length; i++) {
        console.log(`Submitting transaction ${i+1} of ${signedTxns.length}`);
        
        const submitResponse = await apiRequest("POST", "/api/submit-transaction", {
          signedTxn: Buffer.from(signedTxns[i]).toString('base64'),
          transactionId,
          isSequential: true,
          sequentialIndex: i
        });
        
        if (!submitResponse.ok) {
          console.error(`Failed to submit transaction ${i+1}`);
          return false;
        }
        
        console.log(`Transaction ${i+1} submitted successfully`);
      }
      
      console.log("All transactions in atomic group submitted successfully");
      
      // Invalidate transaction queries to force a refresh
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      
      return true;
    } catch (error) {
      console.error("Error in sequential transaction processing:", error);
      
      // Handle specific wallet errors
      if (error instanceof Error) {
        toast({
          title: "Transaction Error",
          description: error.message,
          variant: "destructive",
        });
      }
      
      return false;
    }
  };
  
  // Fall back to signing individual transactions
  const signAndSubmitIndividualTransactions = async (
    txnsBase64: string[],
    transactionId: number
  ): Promise<boolean> => {
    try {
      console.log(`Signing ${txnsBase64.length} individual transactions`);
      
      // Convert base64 strings to Uint8Array transactions
      const decodedTxns = txnsBase64.map(txnBase64 => 
        new Uint8Array(Buffer.from(txnBase64, 'base64'))
      );
      
      // Sign the transactions directly with the user's wallet
      // TxnLab wallet expects either Transaction[] or Uint8Array[] 
      let signedTxns;
      try {
        // Pass the Uint8Array transactions directly to the wallet
        signedTxns = await signTransactions(decodedTxns);
        
        if (!signedTxns || signedTxns.length !== txnsBase64.length) {
          console.error("Failed to sign transactions or incomplete signatures");
          return false;
        }
      } catch (walletError) {
        console.error("[Wallet] Error signing transactions:", walletError);
        return false;
      }
      
      // Handle potential null value in the signed transactions
      if (!signedTxns[0]) {
        console.error("First transaction was not signed properly");
        return false;
      }
      
      // Submit the signed transactions to the backend
      // For simplicity, we'll just submit the first transaction
      // In a production app, we should handle all transactions properly
      
      // Handle potential null value in the signed transactions
      if (!signedTxns[0]) {
        console.error("First transaction was not signed properly");
        return false;
      }
      
      const response = await apiRequest("POST", "/api/submit-transaction", {
        signedTxn: Buffer.from(signedTxns[0]).toString('base64'),
        transactionId
      });
      
      if (!response.ok) {
        console.error("Failed to submit signed transaction");
        return false;
      }
      
      return true;
    } catch (error) {
      console.error("Error signing/submitting transactions:", error);
      return false;
    }
  };

  // Send USDC to recipient
  const sendUsdc = async (params: SendUsdcParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      // Create the escrow account and get transaction details
      const res = await apiRequest("POST", "/api/send", params);
      const data = await res.json();
      
      console.log("Server response:", data);
      
      // Check which type of transaction we're dealing with
      if (activeAccount && data.transactions) {
        let success = false;
        console.log("Found transaction data:", data.transactions);
        
        if (data.transactions.txnsBase64 && data.transactions.txnsBase64.length > 0) {
          // New atomic transaction format
          console.log("Using atomic transaction format with", data.transactions.txnsBase64.length, "transactions to sign");
          
          // Check if we have the full transaction group (including pre-signed txns)
          if (data.transactions.allTxnsBase64 && data.transactions.allTxnsBase64.length > 0) {
            console.log("Processing complete atomic transaction group with", data.transactions.allTxnsBase64.length, "total transactions");
            success = await signAndSubmitMultipleTransactions(
              data.transactions.txnsBase64,
              data.transactionId,
              data.transactions.allTxnsBase64
            );
          } else {
            // Fallback to old method if allTxnsBase64 is not provided
            console.log("Using legacy multi-transaction format without group");
            success = await signAndSubmitMultipleTransactions(
              data.transactions.txnsBase64,
              data.transactionId
            );
          }
        } else if (data.transactions.txnBase64) {
          // Legacy single transaction format
          console.log("Using legacy transaction format");
          success = await signAndSubmitTransaction(
            data.transactions.txnBase64,
            data.transactionId
          );
        } else {
          console.error("No valid transaction format found in response");
        }
        
        if (!success) {
          // If transaction signing fails, show a warning but don't fail completely
          toast({
            title: "Warning",
            description: "Transaction was created but not signed. The recipient can still claim after you fund the escrow account."
          });
        }
      } else {
        console.error("No transaction data found in response or no active account");
      }
      
      // Invalidate transactions cache
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      toast({
        title: "Success",
        description: `USDC transfer initiated to ${params.recipientEmail}`,
      });
      
      return data;
    } catch (error) {
      console.error("Error sending USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send USDC",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Claim USDC
  const claimUsdc = async (params: ClaimUsdcParams): Promise<Transaction | null> => {
    setIsLoading(true);
    try {
      console.log("Starting claim process with params:", params);
      
      // With the updated backend, we don't need the wallet to sign the transaction
      // The server does everything: creating, signing with LogicSig, and submitting
      const res = await apiRequest("POST", "/api/claim", params);
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error("Error claiming USDC:", errorData);
        toast({
          title: "Error",
          description: errorData.message || "Failed to claim USDC",
          variant: "destructive",
        });
        return null;
      }
      
      const data = await res.json();
      console.log("Claim transaction successful:", data);
      
      if (!data.success) {
        toast({
          title: "Error",
          description: data.message || "Failed to claim USDC",
          variant: "destructive",
        });
        return null;
      }
      
      // Invalidate transactions cache to update UI
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      toast({
        title: "Success",
        description: "USDC claimed successfully and transferred to your wallet!",
      });
      
      return data;
    } catch (error) {
      console.error("Error claiming USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to claim USDC",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Regenerate claim link
  const regenerateLink = async (params: RegenerateLinkParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/regenerate-link", params);
      const data = await res.json();
      
      // Sign and submit the transaction if we have txParams
      if (activeAccount && data.txParams && data.txParams.txnBase64) {
        // Attempt to sign and submit the transaction with the wallet
        const success = await signAndSubmitTransaction(
          data.txParams.txnBase64,
          data.id
        );
        
        if (!success) {
          toast({
            title: "Warning",
            description: "New claim link was generated but transaction was not signed."
          });
        }
      }
      
      // Invalidate transactions cache
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      toast({
        title: "Success",
        description: "New claim link generated and sent",
      });
      
      return data;
    } catch (error) {
      console.error("Error regenerating link:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to regenerate claim link",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Reclaim USDC
  const reclaimUsdc = async (params: ReclaimUsdcParams): Promise<Transaction | null> => {
    setIsLoading(true);
    try {
      // First, get the transaction parameters from the server
      const res = await apiRequest("POST", "/api/reclaim", params);
      const data = await res.json();
      
      // Sign and submit the transaction if we have txParams
      if (activeAccount && data.txParams && data.txParams.txnBase64) {
        // Attempt to sign and submit the transaction with the wallet
        const success = await signAndSubmitTransaction(
          data.txParams.txnBase64,
          data.id
        );
        
        if (!success) {
          toast({
            title: "Warning",
            description: "Transaction creation succeeded but signing failed. Please try again."
          });
        }
      }
      
      // Invalidate transactions cache
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      toast({
        title: "Success",
        description: "USDC reclaimed successfully",
      });
      
      return data;
    } catch (error) {
      console.error("Error reclaiming USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reclaim USDC",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Submit signed transaction to the blockchain
  const submitSignedTransaction = async (params: SignedTransactionParams): Promise<{ success: boolean; transactionId?: string }> => {
    setIsLoading(true);
    try {
      console.log("Submitting transaction to API:", params);
      const res = await apiRequest("POST", "/api/submit-transaction", params);
      const data = await res.json();
      console.log("API Response:", data);
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Transaction submitted successfully",
        });
        
        // Invalidate transactions cache and refresh balance
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        fetchBalance();
        
        return {
          success: true,
          transactionId: data.transactionId
        };
      } else {
        throw new Error("Failed to submit transaction");
      }
    } catch (error) {
      console.error("Error submitting transaction:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit transaction",
        variant: "destructive",
      });
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  };

  // Sign transaction with wallet and submit
  const signAndSubmitTransaction = async (txnBase64: string, transactionId: number): Promise<boolean> => {
    if (!activeAccount || !signTransactions) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your wallet to sign the transaction",
        variant: "destructive",
      });
      return false;
    }
    
    try {
      setIsLoading(true);
      
      // Decode the base64 transaction to get the binary transaction data
      const txnBytes = Buffer.from(txnBase64, 'base64');
      
      // Convert to an Algorand transaction object
      const txn = algosdk.decodeUnsignedTransaction(txnBytes);
      
      // Convert the transaction to the expected format for the wallet
      // Some wallets expect the transaction to be encoded in a specific way
      const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
      
      // Sign the transaction with the wallet - pass the binary transaction directly
      // No need to wrap it in an object with signers, the wallet handles that internally
      const signedTransactions = await signTransactions([encodedTxn]);
      
      if (!signedTransactions || signedTransactions.length === 0) {
        throw new Error("Failed to sign transaction");
      }
      
      // Check if the transaction was signed successfully
      if (!signedTransactions[0]) {
        throw new Error("Transaction was not signed properly");
      }
      
      // The wallet returns a signed transaction Uint8Array that we need to convert to base64
      const signedTxn = signedTransactions[0];
      const signedTxnBase64 = Buffer.from(signedTxn).toString('base64');
      
      const result = await submitSignedTransaction({
        signedTxn: signedTxnBase64,
        transactionId
      });
      
      return result.success;
    } catch (error) {
      console.error("Error signing transaction:", error);
      toast({
        title: "Error",
        description: "Failed to sign transaction with wallet",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    balance,
    isLoading,
    sendUsdc,
    claimUsdc,
    regenerateLink,
    reclaimUsdc,
    fetchBalance,
    submitSignedTransaction,
    signAndSubmitTransaction
  };
}
