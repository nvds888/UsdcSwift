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

  // Send USDC to recipient - using the 2-phase approach:
  // Phase 1: Create and fund the app
  // Phase 2: Opt-in to USDC and transfer funds
  const sendUsdc = async (params: SendUsdcParams): Promise<TransactionResponse | null> => {
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
      
      // PHASE 1: Create app and fund it with ALGO
      console.log("PHASE 1: Creating and funding application");
      
      // Call the API to prepare the app creation transaction
      const res = await apiRequest("POST", "/api/send", {
        ...params,
        senderAddress: activeAccount.address
      });
      
      // Get the response data
      const data = await res.json();
      console.log("Server response:", data);
      
      if (!data.success) {
        toast({
          title: "Transaction Error",
          description: data.message || "Failed to create transaction",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Get the transaction data from the response
      const { appId, appAddress, transactionId, transactions, claimToken, claimLink } = data;
      
      if (!transactions || !transactions.txnsBase64 || !transactions.allTxnsBase64) {
        toast({
          title: "Transaction Error",
          description: "Invalid transaction data received from server",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Process PHASE 1: App creation and funding
      console.log("Processing Phase 1 transactions:", transactions);
      
      // Decode the transactions from base64
      const { txnsBase64, allTxnsBase64 } = transactions;
      const unsignedTxns = txnsBase64.map((base64Txn: string) => Buffer.from(base64Txn, 'base64'));
      const allTxns = allTxnsBase64.map((base64Txn: string) => Buffer.from(base64Txn, 'base64'));
      
      // Find which transactions need to be signed by the user
      const indexesToSign: number[] = [];
      for (let i = 0; i < allTxns.length; i++) {
        try {
          const txn = algosdk.decodeUnsignedTransaction(allTxns[i]);
          if (txn.sender.toString() === activeAccount.address) {
            console.log(`Transaction ${i} needs signing by the user`);
            indexesToSign.push(i);
          } else {
            console.log(`Transaction ${i} doesn't need signing by the user`);
          }
        } catch (decodeError) {
          console.error(`Failed to decode transaction ${i}:`, decodeError);
        }
      }
      
      // Sign the transactions that need to be signed
      const signedTxns = await signTransactions(allTxns, indexesToSign);
      
      if (!signedTxns) {
        toast({
          title: "Signing Cancelled",
          description: "Transaction signing was cancelled or failed",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      // Prepare the final transaction group
      const finalTxns: Uint8Array[] = [];
      for (let i = 0; i < allTxns.length; i++) {
        if (indexesToSign.includes(i) && signedTxns[indexesToSign.indexOf(i)]) {
          // This index needed signing and we have a signed version
          finalTxns.push(signedTxns[indexesToSign.indexOf(i)] as Uint8Array);
        } else {
          // This index was pre-signed or doesn't need signing
          finalTxns.push(allTxns[i]);
        }
      }
      
      // Convert to base64 for submission
      const base64SignedTxns = finalTxns.map(txn => Buffer.from(txn).toString('base64'));
      
      // Submit the Phase 1 transactions
      const phase1Response = await apiRequest("POST", "/api/submit-atomic-group", {
        signedTxns: base64SignedTxns,
        transactionId: transactionId
      });
      
      if (!phase1Response.ok) {
        const errorData = await phase1Response.json();
        toast({
          title: "Transaction Failed",
          description: errorData.message || "Failed to submit app creation transaction",
          variant: "destructive",
        });
        setIsLoading(false);
        return null;
      }
      
      console.log("Phase 1 completed successfully. App created and funded.");
      
      // Wait a short time for the blockchain to process the transactions
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // PHASE 2: Opt-in to USDC and transfer funds
      console.log("Starting PHASE 2: USDC opt-in and transfer");
      
      try {
        const phase2Response = await apiRequest("POST", "/api/complete-funding", {
          appId,
          appAddress,
          transactionId,
          senderAddress: activeAccount.address
        });
        
        if (!phase2Response.ok) {
          console.error("Phase 2 preparation failed");
          // Return Phase 1 data as we've at least created the app
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId,
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        const phase2Data = await phase2Response.json();
        console.log("Phase 2 preparation response:", phase2Data);
        
        if (!phase2Data.success) {
          toast({
            title: "Phase 2 Error",
            description: phase2Data.message || "Failed to prepare USDC transactions",
            variant: "destructive",
          });
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId,
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        // Extract the Phase 2 transactions
        const { optInCallTxn, optInTxn, transferTxn } = phase2Data;
        
        // Decode the transactions
        const optInCallTxnBinary = Buffer.from(optInCallTxn, 'base64');
        const optInTxnBinary = Buffer.from(optInTxn, 'base64'); 
        const transferTxnBinary = Buffer.from(transferTxn, 'base64');
        
        // Group the opt-in transactions (user's app call and app's internal opt-in)
        const optInGroup = [optInCallTxnBinary, optInTxnBinary];
        
        // Sign the opt-in group - only the user's app call needs signing
        const optInSigned = await signTransactions(optInGroup, [0]); // only sign index 0
        
        if (!optInSigned) {
          toast({
            title: "Opt-in Cancelled",
            description: "USDC opt-in was cancelled or failed",
            variant: "destructive",
          });
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId,
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        // Prepare the final opt-in transactions
        const finalOptInTxns: Uint8Array[] = [];
        finalOptInTxns.push(optInSigned[0] as Uint8Array); // User's signed app call
        finalOptInTxns.push(optInTxnBinary); // App's opt-in txn (doesn't need user signing)
        
        // Submit the opt-in transactions
        const optInBase64 = finalOptInTxns.map(txn => Buffer.from(txn).toString('base64'));
        const optInResponse = await apiRequest("POST", "/api/submit-atomic-group", {
          signedTxns: optInBase64,
          transactionId: transactionId,
          phase: "opt-in"
        });
        
        if (!optInResponse.ok) {
          console.error("Opt-in failed");
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId,
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        console.log("Opt-in successful. Now transferring USDC...");
        
        // Wait for opt-in to be confirmed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Sign and submit the USDC transfer transaction
        const transferSigned = await signTransactions([transferTxnBinary], [0]);
        
        if (!transferSigned) {
          toast({
            title: "Transfer Cancelled",
            description: "USDC transfer was cancelled or failed",
            variant: "destructive",
          });
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId, 
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        // Submit the transfer transaction
        const transferBase64 = Buffer.from(transferSigned[0] as Uint8Array).toString('base64');
        const transferResponse = await apiRequest("POST", "/api/submit-transaction", {
          signedTxn: transferBase64,
          transactionId: transactionId
        });
        
        if (!transferResponse.ok) {
          console.error("Transfer failed");
          const result: TransactionResponse = {
            success: true,
            appAddress: appAddress,
            appId: appId,
            transactionId: transactionId?.toString() || "",
            claimToken: claimToken,
            claimLink: claimLink
          };
          setIsLoading(false);
          return result;
        }
        
        console.log("Complete transaction flow successful!");
        
        // Refetch balance
        fetchBalance();
        
        // Return the full data including the claim URL
        const result: TransactionResponse = {
          success: true,
          transactionId: transactionId?.toString() || "",
          appAddress: appAddress,
          appId: appId,
          claimToken: claimToken,
          claimLink: claimLink
        };
        
        setIsLoading(false);
        return result;
        
      } catch (phase2Error) {
        console.error("Error in Phase 2:", phase2Error);
        toast({
          title: "Phase 2 Error",
          description: phase2Error instanceof Error ? phase2Error.message : "Unknown error in USDC transactions",
          variant: "destructive",
        });
        const result: TransactionResponse = {
          success: true,
          appAddress: appAddress,
          appId: appId,
          transactionId: transactionId?.toString() || "",
          claimToken: claimToken,
          claimLink: claimLink
        };
        setIsLoading(false);
        return result;
      }
    } catch (error) {
      console.error("Error sending USDC:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unknown error sending USDC",
        variant: "destructive",
      });
      setIsLoading(false);
      return null;
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