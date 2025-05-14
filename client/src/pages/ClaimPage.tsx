import React, { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useWallet } from "@txnlab/use-wallet-react";
import { useAlgorand } from "@/hooks/use-algorand";
import { useToast } from "@/hooks/use-toast";
import { Transaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Gift, ExternalLink, Wallet, Info } from "lucide-react";
import WalletModal from "@/components/WalletModal";
import { useQuery } from "@tanstack/react-query";

const ClaimPage: React.FC = () => {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/claim/:token");
  const { toast } = useToast();
  const { activeAccount, wallets } = useWallet();
  const { claimUsdc, isLoading } = useAlgorand();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimTxId, setClaimTxId] = useState<string>("");
  
  const claimToken = params?.token || "";
  
  // Fetch claim details
  const { data: transaction, isLoading: isLoadingClaim, error } = useQuery<Transaction>({
    queryKey: [`/api/claim/${claimToken}`],
    enabled: !!claimToken,
  });
  
  // Format date for display
  const formatDate = (dateString?: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };
  
  // Truncate address for display
  const truncateAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };
  
  // Handle wallet connection
  const handleConnectWallet = () => {
    if (!activeAccount) {
      setIsWalletModalOpen(true);
    }
  };
  
  // Handle claim button click
  const handleClaim = async () => {
    if (!activeAccount || !transaction) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet to claim your USDC",
        variant: "destructive",
      });
      setIsWalletModalOpen(true);
      return;
    }
    
    try {
      const result = await claimUsdc({
        claimToken,
        recipientAddress: activeAccount.address,
      });
      
      if (result) {
        setClaimSuccess(true);
        setClaimTxId(result.transactionId || "");
        toast({
          title: "Success",
          description: "USDC claimed successfully!",
        });
      }
    } catch (error) {
      console.error("Error claiming USDC:", error);
      toast({
        title: "Error",
        description: "Failed to claim USDC. Please try again.",
        variant: "destructive",
      });
    }
  };
  
  // Redirect if claim token is missing
  useEffect(() => {
    if (!claimToken) {
      navigate("/");
    }
  }, [claimToken, navigate]);
  
  // Show error if claim not found
  if (error) {
    return (
      <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-6 md:p-8 text-center">
              <h2 className="text-2xl font-semibold mb-4">Claim Not Found</h2>
              <p className="text-gray-600 mb-6">
                This claim link is invalid or has expired. Please contact the sender for a new link.
              </p>
              <Button onClick={() => navigate("/")}>
                Return Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }
  
  // Loading state
  if (isLoadingClaim || !transaction) {
    return (
      <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-6 md:p-8">
              <div className="flex justify-center mb-6">
                <Skeleton className="h-16 w-16 rounded-full" />
              </div>
              <Skeleton className="h-8 w-2/3 mx-auto mb-3" />
              <Skeleton className="h-4 w-5/6 mx-auto mb-6" />
              
              <div className="bg-gray-50 rounded-lg p-5 mb-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-6 w-full mb-4" />
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-6 w-full mb-4" />
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-6 w-full" />
              </div>
              
              <Skeleton className="h-12 w-full mb-3" />
              <Skeleton className="h-4 w-3/4 mx-auto" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }
  
  // If already claimed
  if (transaction.claimed && !claimSuccess) {
    return (
      <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-6 md:p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
                  <Info className="h-8 w-8 text-amber-600" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-4">Already Claimed</h2>
              <p className="text-gray-600 mb-6">
                This USDC has already been claimed on {formatDate(transaction.claimedAt)}.
              </p>
              <Button onClick={() => navigate("/")}>
                Return Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }
  
  return (
    <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-2xl mx-auto">
        {/* Claim Card */}
        {!claimSuccess && (
          <Card>
            <CardContent className="p-6 md:p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-16 w-16 rounded-full bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] flex items-center justify-center">
                  <Gift className="h-8 w-8 text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-3">
                You've received {transaction.amount} USDC!
              </h2>
              <p className="text-gray-600 mb-6">
                <span className="font-semibold">{truncateAddress(transaction.senderAddress)}</span> has sent you USDC on the Algorand blockchain. Connect your wallet to claim it.
              </p>
              
              <div className="bg-gray-50 rounded-lg p-5 mb-6 text-left">
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <span className="block text-sm text-gray-500 mb-1">From</span>
                  <span className="font-medium">{truncateAddress(transaction.senderAddress)}</span>
                </div>
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <span className="block text-sm text-gray-500 mb-1">Amount</span>
                  <div className="flex items-center">
                    <span className="font-semibold text-lg mr-2">{transaction.amount} USDC</span>
                    <span className="text-sm text-gray-500">≈ ${transaction.amount} USD</span>
                  </div>
                </div>
                {transaction.note && (
                  <div className="mb-0">
                    <span className="block text-sm text-gray-500 mb-1">Message</span>
                    <p className="text-gray-800">{transaction.note}</p>
                  </div>
                )}
              </div>
              
              <div className="mb-8">
                <Button
                  className="w-full bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white py-6"
                  onClick={activeAccount ? handleClaim : handleConnectWallet}
                  disabled={isLoading}
                >
                  <Wallet className="mr-2 h-5 w-5" />
                  {activeAccount ? "Claim Your USDC" : "Connect Wallet to Claim"}
                </Button>
                <p className="mt-3 text-sm text-gray-500">
                  Connect your Pera or Defly wallet to receive your USDC
                </p>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <Info className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      New to Algorand? Download the <a href="https://perawallet.app/" target="_blank" rel="noopener noreferrer" className="font-medium underline">Pera Wallet</a> or <a href="https://defly.app/" target="_blank" rel="noopener noreferrer" className="font-medium underline">Defly Wallet</a> to claim your funds.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Success Card */}
        {claimSuccess && (
          <Card>
            <CardContent className="p-6 md:p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-16 w-16 rounded-full bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] flex items-center justify-center">
                  <Check className="h-8 w-8 text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-3">Funds Claimed Successfully!</h2>
              <p className="text-gray-600 mb-6">
                The USDC has been transferred to your wallet. Thank you for using AlgoSend.
              </p>
              
              <div className="bg-gray-50 rounded-lg p-5 mb-6 text-left">
                <h3 className="font-medium mb-3">Transaction details</h3>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Transaction ID</span>
                    <span className="font-medium truncate ml-4">{claimTxId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Amount</span>
                    <span className="font-medium">{transaction.amount} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Date & Time</span>
                    <span className="font-medium">{formatDate(new Date().toISOString())}</span>
                  </div>
                </div>
              </div>
              
              <div className="text-center">
                <a 
                  href={`https://explorer.algorand.org/tx/${claimTxId}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-[#00AC6B] hover:underline"
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  View on Algorand Explorer
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Wallet Modal */}
      <WalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
        wallets={wallets}
      />
    </main>
  );
};

export default ClaimPage;
