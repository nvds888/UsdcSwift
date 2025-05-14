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
      // Check if we have a custom asset ID in local storage
      const customAssetId = localStorage.getItem("usdc_asset_id");
      
      // Build the URL with the asset ID parameter if available
      let url = `/api/balance?address=${activeAccount.address}`;
      if (customAssetId) {
        url += `&assetId=${customAssetId}`;
        console.log(`Using custom asset ID: ${customAssetId}`);
      }
      
      const response = await fetch(url);
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

  // Send USDC to recipient
  const sendUsdc = async (params: SendUsdcParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      // Create the escrow account and get transaction details
      const res = await apiRequest("POST", "/api/send", params);
      const data = await res.json();
      
      // Sign and submit the transaction if we have txParams
      if (activeAccount && data.txParams && data.txParams.txnBase64) {
        // Attempt to sign and submit the transaction with the wallet
        const success = await signAndSubmitTransaction(
          data.txParams.txnBase64,
          data.id
        );
        
        if (!success) {
          // If transaction signing fails, show a warning but don't fail completely
          // This might happen if the user rejects the transaction
          toast({
            title: "Warning",
            description: "Transaction was created but not signed. The recipient can still claim after you fund the escrow account."
          });
        }
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
      // Get the transaction details and prepare the claim transaction
      const res = await apiRequest("POST", "/api/claim", params);
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
            description: "Unable to sign the claim transaction. Please try again."
          });
        }
      }
      
      toast({
        title: "Success",
        description: "USDC claimed successfully",
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
      const res = await apiRequest("POST", "/api/submit-transaction", params);
      const data = await res.json();
      
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
      
      // Sign the transaction with the wallet
      const singleTxnGroups = [{
        txn: txn,
        signers: [activeAccount.address]
      }];
      
      const signedTransactions = await signTransactions(singleTxnGroups);
      
      if (!signedTransactions || signedTransactions.length === 0) {
        throw new Error("Failed to sign transaction");
      }
      
      // The wallet should return a signed transaction Uint8Array that we need to convert to base64
      const signedTxnBase64 = Buffer.from(signedTransactions[0] || new Uint8Array()).toString('base64');
      
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
