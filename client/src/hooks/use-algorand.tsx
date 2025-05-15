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
  // MODIFIED: Handle Algorand SDK validation issues with app creation
  const signAndSubmitAtomicGroup = async (
    txnsToSign: string[],
    allTxns: string[],
    transactionId: number
  ): Promise<boolean> => {
    try {
      console.log(`Processing atomic group: ${allTxns.length} total txns, ${txnsToSign.length} to sign`);
      
      // For app creation, we'll process transactions individually rather than as a group
      // to avoid Algorand SDK validation errors with app creation transactions
      
      // Convert transactions that need signing to Uint8Array format
      const txnsToSignBinary: Uint8Array[] = txnsToSign.map(txn => 
        new Uint8Array(Buffer.from(txn, 'base64'))
      );
      
      // Sign the transactions that need signing
      console.log(`Signing ${txnsToSignBinary.length} transactions directly`);
      const signedTxns = await signTransactions(txnsToSignBinary);
      
      if (!signedTxns || signedTxns.length !== txnsToSignBinary.length) {
        console.error("Failed to sign transactions or user cancelled");
        toast({
          title: "Transaction Cancelled",
          description: "Transaction signing was cancelled",
          variant: "destructive",
        });
        return false;
      }
      
      // First try sending the app creation transaction individually
      console.log("Submitting app creation transaction individually");
      
      // Type safety check to ensure we have a Uint8Array
      if (!signedTxns[0]) {
        console.error("First transaction wasn't signed properly");
        return false;
      }
      
      const appCreateTxnBase64 = Buffer.from(signedTxns[0] as Uint8Array).toString('base64');
      const createResponse = await apiRequest("POST", "/api/submit-transaction", {
        signedTxn: appCreateTxnBase64,
        transactionId: transactionId
      });
      
      if (!createResponse.ok) {
        console.error("Failed to submit app creation transaction");
        toast({
          title: "App Creation Failed",
          description: "Failed to create the application on Algorand",
          variant: "destructive",
        });
        return false;
      }
      
      // Wait a moment for app creation to be confirmed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Submit funding transaction
      if (signedTxns.length > 1 && signedTxns[1]) {
        console.log("Submitting app funding transaction");
        const fundingTxnBase64 = Buffer.from(signedTxns[1] as Uint8Array).toString('base64');
        const fundingResponse = await apiRequest("POST", "/api/submit-transaction", {
          signedTxn: fundingTxnBase64,
          transactionId: transactionId
        });
        
        if (!fundingResponse.ok) {
          console.error("Failed to submit app funding transaction");
          toast({
            title: "Transaction Warning",
            description: "App was created but funding failed. You may need to manually fund the app.",
            variant: "destructive",
          });
          // Continue anyway since the app was created
        }
      }
      
      console.log("Phase 1 transactions completed successfully");
      
      // Refresh transactions
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      
      return true;
    } catch (error) {
      console.error("Error in atomic transaction group signing:", error);
      
      // Handle specific wallet errors
      if (error instanceof Error) {
        if (error.message.includes("transaction group has failed validation")) {
          toast({
            title: "Trying Alternative Approach",
            description: "Transaction grouping failed. Attempting transactions individually...",
            variant: "destructive",
          });
          
          // Fallback to individual transaction submission method
          return await signAndSubmitIndividualTransactions(txnsToSign, transactionId);
        } else {
          toast({
            title: "Transaction Error",
            description: error.message,
            variant: "destructive",
          });
        }
      }
      
      return false;
    }
  };
  
  // Fall back to signing individual transactions
  // UPDATED: Using sequential individual transaction submission
  const signAndSubmitIndividualTransactions = async (
    txnsBase64: string[],
    transactionId: number
  ): Promise<boolean> => {
    try {
      console.log(`Attempting sequential approach: ${txnsBase64.length} transactions`);
      
      // Convert base64 strings to Uint8Array transactions
      const decodedTxns = txnsBase64.map(txnBase64 => 
        new Uint8Array(Buffer.from(txnBase64, 'base64'))
      );
      
      // Sign the transactions directly with the user's wallet
      console.log("Requesting wallet to sign transactions...");
      let signedTxns;
      try {
        // Pass the Uint8Array transactions directly to the wallet
        signedTxns = await signTransactions(decodedTxns);
        
        if (!signedTxns || signedTxns.length !== txnsBase64.length) {
          console.error("Failed to sign transactions or incomplete signatures");
          toast({
            title: "Signing Failed",
            description: "Some transactions weren't signed properly",
            variant: "destructive",
          });
          return false;
        }
      } catch (walletError) {
        console.error("[Wallet] Error signing transactions:", walletError);
        toast({
          title: "Wallet Error",
          description: walletError instanceof Error ? walletError.message : "Unknown wallet error",
          variant: "destructive",
        });
        return false;
      }
      
      // Process each transaction in sequence with delays between them
      // This approach works better for app creation + funding
      
      let successCount = 0;
      
      // First process the app creation transaction (if any)
      if (signedTxns[0]) {
        console.log("Submitting first transaction (app creation)");
        const firstTxnBase64 = Buffer.from(signedTxns[0] as Uint8Array).toString('base64');
        const response = await apiRequest("POST", "/api/submit-transaction", {
          signedTxn: firstTxnBase64,
          transactionId: transactionId
        });
        
        if (!response.ok) {
          console.error("Failed to submit app creation transaction");
          toast({
            title: "Transaction Failed",
            description: "Could not create the application",
            variant: "destructive",
          });
          return false;
        }
        
        successCount++;
        console.log("First transaction succeeded");
        
        // Wait for confirmation before proceeding
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Process remaining transactions
      for (let i = 1; i < signedTxns.length; i++) {
        if (!signedTxns[i]) continue;
        
        console.log(`Submitting transaction ${i+1}`);
        const txnBase64 = Buffer.from(signedTxns[i] as Uint8Array).toString('base64');
        
        try {
          const response = await apiRequest("POST", "/api/submit-transaction", {
            signedTxn: txnBase64,
            transactionId: transactionId
          });
          
          if (response.ok) {
            successCount++;
            console.log(`Transaction ${i+1} succeeded`);
          } else {
            console.error(`Transaction ${i+1} failed`);
            
            if (i === 1) {
              // If the second transaction (app funding) fails, we should notify
              toast({
                title: "App Funding Failed",
                description: "App was created but funding failed",
                variant: "destructive",
              });
            }
          }
          
          // Small delay between transactions
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error submitting transaction ${i+1}:`, error);
        }
      }
      
      console.log(`${successCount} of ${signedTxns.length} transactions processed successfully`);
      
      // Refresh transactions
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      
      // Consider success if at least the app creation worked
      return successCount > 0;
    } catch (error) {
      console.error("Error signing/submitting transactions:", error);
      return false;
    }
  };

  // Send USDC to recipient - using the 2-phase approach:
  // Phase 1: Create and fund the app
  // Phase 2: Opt-in to USDC and transfer funds
  const sendUsdc = async (params: SendUsdcParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      if (!activeAccount) {
        toast({
          title: "Wallet Error",
          description: "No wallet connected",
          variant: "destructive",
        });
        return null;
      }
      
      // Phase 1: Create the app
      const phase1Response = await apiRequest("POST", "/api/send", {
        ...params,
        senderAddress: activeAccount.address
      });
      
      const phase1Data = await phase1Response.json();
      
      if (!phase1Data.success) {
        throw new Error(phase1Data.message || "Failed to create app");
      }
      
      // Sign and submit phase 1 transactions
      const phase1TxnsToSign = phase1Data.transactions.txnsBase64.map(
        base64 => Buffer.from(base64, 'base64')
      );
      
      const signedPhase1Txns = await signTransactions(phase1TxnsToSign);
      
      if (!signedPhase1Txns) {
        toast({
          title: "Transaction Cancelled",
          description: "App creation was cancelled",
          variant: "destructive",
        });
        return null;
      }
      
      // Submit phase 1 transactions
      const phase1SubmitResponse = await apiRequest("POST", "/api/submit-transaction", {
        signedTxn: Buffer.from(signedPhase1Txns[0]).toString('base64'),
        transactionId: phase1Data.transactionId
      });
      
      const submitResult = await phase1SubmitResponse.json();
      
      if (!submitResult.success) {
        throw new Error("Failed to create app");
      }
      
      // Extract app ID from the transaction result
      // Wait for confirmation and get app ID
      await algosdk.waitForConfirmation(algodClient, submitResult.transactionId, 5);
      
      // Get transaction info to extract app ID
      const txInfo = await algodClient.pendingTransactionInformation(submitResult.transactionId).do();
      const appId = txInfo['application-index'];
      
      // Phase 2: Fund and transfer
      const phase2Response = await apiRequest("POST", "/api/complete-app-setup", {
        transactionId: phase1Data.transactionId,
        appId
      });
      
      const phase2Data = await phase2Response.json();
      
      if (!phase2Data.success) {
        throw new Error(phase2Data.message || "Failed to complete app setup");
      }
      
      // Sign only the transactions that need signing
      const phase2TxnsToSign = phase2Data.transactions.indexesToSign.map(
        index => Buffer.from(phase2Data.transactions.txnsBase64[index], 'base64')
      );
      
      const signedPhase2Txns = await signTransactions(phase2TxnsToSign);
      
      if (!signedPhase2Txns) {
        toast({
          title: "Transaction Cancelled",
          description: "Fund and transfer was cancelled",
          variant: "destructive",
        });
        return null;
      }
      
      // Submit phase 2 transactions as a group
      const finalTxns = phase2Data.transactions.txnsBase64.map((txn, index) => {
        const signedIndex = phase2Data.transactions.indexesToSign.indexOf(index);
        if (signedIndex >= 0) {
          return Buffer.from(signedPhase2Txns[signedIndex]).toString('base64');
        }
        return txn; // Already signed or doesn't need signing
      });
      
      const phase2SubmitResponse = await apiRequest("POST", "/api/submit-atomic-group", {
        signedTxns: finalTxns,
        transactionId: phase1Data.transactionId,
        approach: "app"
      });
      
      const phase2SubmitResult = await phase2SubmitResponse.json();
      
      if (!phase2SubmitResult.success) {
        throw new Error("Failed to fund and transfer");
      }
      
      // Success!
      return {
        success: true,
        transactionId: phase1Data.transactionId,
        appAddress: phase2Data.appAddress,
        appId,
        claimToken: phase1Data.claimToken,
        claimLink: phase1Data.claimLink
      };
      
    } catch (error) {
      console.error("Error sending USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Claim USDC from an existing transaction
  const claimUsdc = async (params: ClaimUsdcParams): Promise<Transaction | null> => {
    setIsLoading(true);
    try {
      if (!activeAccount) {
        toast({
          title: "Wallet Error",
          description: "No wallet connected. Please connect your wallet first.",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      const response = await apiRequest("POST", "/api/claim", {
        ...params,
        recipientAddress: activeAccount.address
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        toast({
          title: "Claim Error",
          description: data.message || "Failed to claim USDC",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Handle signing and submission similar to sendUsdc
      // ...
      
      // Refetch balance
      fetchBalance();
      
      setIsLoading(false);
      return data.transaction;
    } catch (error) {
      console.error("Error claiming USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error claiming USDC",
        variant: "destructive",
      });
      setIsLoading(false);
      return null;
    }
  };

  // Regenerate a claim link for an existing transaction
  const regenerateLink = async (params: RegenerateLinkParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/regenerate-link", params);
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        toast({
          title: "Error",
          description: data.message || "Failed to regenerate claim link",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      setIsLoading(false);
      return data;
    } catch (error) {
      console.error("Error regenerating link:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error regenerating link",
        variant: "destructive",
      });
      setIsLoading(false);
      return null;
    }
  };

  // Reclaim USDC from an existing transaction back to the sender
  const reclaimUsdc = async (params: ReclaimUsdcParams): Promise<Transaction | null> => {
    setIsLoading(true);
    try {
      if (!activeAccount) {
        toast({
          title: "Wallet Error",
          description: "No wallet connected. Please connect your wallet first.",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Check if we're the original sender
      // (This validation could also be done on the server)
      
      const response = await apiRequest("POST", "/api/reclaim", {
        ...params,
        senderAddress: activeAccount.address
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        toast({
          title: "Reclaim Error",
          description: data.message || "Failed to reclaim USDC",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Handle signing and submission similar to sendUsdc
      // ...
      
      // Refetch balance
      fetchBalance();
      
      setIsLoading(false);
      return data.transaction;
    } catch (error) {
      console.error("Error reclaiming USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error reclaiming USDC",
        variant: "destructive",
      });
      setIsLoading(false);
      return null;
    }
  };
  
  // Submit a pre-signed transaction
  const submitSignedTransaction = async (params: SignedTransactionParams): Promise<{ success: boolean; transactionId?: string }> => {
    try {
      const response = await apiRequest("POST", "/api/submit-transaction", params);
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        console.error("Failed to submit signed transaction:", data.message);
        return { success: false };
      }
      
      return { success: true, transactionId: data.transactionId };
    } catch (error) {
      console.error("Error submitting transaction:", error);
      return { success: false };
    }
  };

  return {
    balance,
    isLoading,
    sendUsdc,
    claimUsdc,
    regenerateLink,
    reclaimUsdc,
    submitSignedTransaction,
    fetchBalance,
  };
}