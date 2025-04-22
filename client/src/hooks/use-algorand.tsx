import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Transaction, TransactionResponse, SendUsdcParams, ClaimUsdcParams, RegenerateLinkParams, ReclaimUsdcParams } from "@/lib/types";

export function useAlgorand() {
  const { activeAccount } = useWallet();
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

  // Send USDC to recipient
  const sendUsdc = async (params: SendUsdcParams): Promise<TransactionResponse | null> => {
    setIsLoading(true);
    try {
      // First, create the escrow account and get transaction details
      const res = await apiRequest("POST", "/api/send", params);
      const data = await res.json();
      
      // In a production app, this would handle the actual transaction signing
      // using the connected wallet
      if (activeAccount && data.txParams) {
        // This would be where we'd sign and submit the transaction
        // For example:
        // const algodClient = new algosdk.Algodv2(token, server, port);
        // const suggestedParams = await algodClient.getTransactionParams().do();
        // const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        //   from: activeAccount.address,
        //   to: data.txParams.escrowAddress,
        //   amount: Math.floor(data.txParams.amount * 1_000_000), // Convert to microUSDC
        //   assetIndex: USDC_ASSET_ID,
        //   suggestedParams
        // });
        // const signedTxn = await window.algorand.signTransaction(txn.toByte());
        // await algodClient.sendRawTransaction(signedTxn).do();
      }
      
      // Invalidate transactions cache
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      toast({
        title: "Success",
        description: `USDC sent to ${params.recipientEmail}`,
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
      // First, get the transaction parameters from the server
      const res = await apiRequest("POST", "/api/claim", params);
      const data = await res.json();
      
      // In a production app, this would handle the actual transaction signing
      // using the connected wallet
      if (activeAccount && data.txParams) {
        // This would be where we'd sign and submit the transaction
        // For example:
        // const algodClient = new algosdk.Algodv2(token, server, port);
        // const suggestedParams = await algodClient.getTransactionParams().do();
        // const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        //   from: data.txParams.escrowAddress,
        //   to: activeAccount.address,
        //   amount: Math.floor(data.txParams.amount * 1_000_000), // Convert to microUSDC
        //   assetIndex: USDC_ASSET_ID,
        //   note: new Uint8Array(Buffer.from(data.txParams.claimToken)),
        //   suggestedParams
        // });
        // const signedTxn = await window.algorand.signTransaction(txn.toByte());
        // await algodClient.sendRawTransaction(signedTxn).do();
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
      
      // In a production app, this would handle the actual transaction signing
      // using the connected wallet
      if (activeAccount && data.txParams) {
        // This would be where we'd sign and submit the transaction
        // For example:
        // const algodClient = new algosdk.Algodv2(token, server, port);
        // const suggestedParams = await algodClient.getTransactionParams().do();
        // const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        //   from: data.txParams.escrowAddress,
        //   to: activeAccount.address,
        //   amount: Math.floor(data.txParams.amount * 1_000_000), // Convert to microUSDC
        //   assetIndex: USDC_ASSET_ID,
        //   suggestedParams
        // });
        // const signedTxn = await window.algorand.signTransaction(txn.toByte());
        // await algodClient.sendRawTransaction(signedTxn).do();
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

  return {
    balance,
    isLoading,
    sendUsdc,
    claimUsdc,
    regenerateLink,
    reclaimUsdc,
    fetchBalance,
  };
}
