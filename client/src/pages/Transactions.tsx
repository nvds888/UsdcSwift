import React, { useState } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@txnlab/use-wallet-react";
import { useToast } from "@/hooks/use-toast";
import { useAlgorand } from "@/hooks/use-algorand";
import { Transaction, TransactionStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery } from "@tanstack/react-query";
import { Send, Clock, CheckCircle, Filter, ArrowUpRight } from "lucide-react";
import WalletModal from "@/components/WalletModal";

const Transactions: React.FC = () => {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeAccount } = useWallet();
  const { regenerateLink, reclaimUsdc, isLoading } = useAlgorand();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [reclaimDialogOpen, setReclaimDialogOpen] = useState(false);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  
  // Fetch transactions
  const { data: transactions, isLoading: isLoadingTransactions, error, refetch } = useQuery({
    queryKey: ["/api/transactions"],
    queryFn: async () => {
      if (!activeAccount?.address) return [];
      const res = await fetch(`/api/transactions?address=${activeAccount.address}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: !!activeAccount?.address,
  });
  
  // Handle reclaim
  const handleReclaim = async () => {
    if (!activeAccount || !selectedTransaction) return;
    
    try {
      await reclaimUsdc({
        transactionId: selectedTransaction.id,
        senderAddress: activeAccount.address,
      });
      
      refetch();
      setReclaimDialogOpen(false);
      setSelectedTransaction(null);
    } catch (error) {
      console.error("Error reclaiming funds:", error);
      toast({
        title: "Error",
        description: "Failed to reclaim funds",
        variant: "destructive",
      });
    }
  };
  
  // Handle regenerate link
  const handleRegenerateLink = async () => {
    if (!activeAccount || !selectedTransaction) return;
    
    try {
      await regenerateLink({
        transactionId: selectedTransaction.id,
        senderAddress: activeAccount.address,
      });
      
      refetch();
      setRegenerateDialogOpen(false);
      setSelectedTransaction(null);
      
      toast({
        title: "Success",
        description: "New claim link generated and sent to recipient",
      });
    } catch (error) {
      console.error("Error regenerating link:", error);
      toast({
        title: "Error",
        description: "Failed to regenerate claim link",
        variant: "destructive",
      });
    }
  };
  
  // Get transaction status
  const getTransactionStatus = (transaction: Transaction): TransactionStatus => {
    if (transaction.claimed) {
      return TransactionStatus.CLAIMED;
    }
    
    if (transaction.expiresAt && new Date(transaction.expiresAt) < new Date()) {
      return TransactionStatus.EXPIRED;
    }
    
    return TransactionStatus.PENDING;
  };
  
  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };
  
  // Prompt user to connect wallet if not connected
  React.useEffect(() => {
    if (!activeAccount) {
      setIsWalletModalOpen(true);
    }
  }, [activeAccount]);
  
  // If no transactions or error
  if (error) {
    return (
      <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-semibold mb-4">Error Loading Transactions</h2>
          <p className="text-gray-600 mb-6">
            We encountered an error loading your transactions. Please try again.
          </p>
          <Button onClick={() => refetch()}>
            Try Again
          </Button>
        </div>
      </main>
    );
  }
  
  return (
    <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Your Transactions</h2>
          <Button variant="outline" size="sm" className="flex items-center">
            <Filter className="mr-2 h-4 w-4" /> Filter
          </Button>
        </div>
        
        <Card className="overflow-hidden">
          {isLoadingTransactions ? (
            // Loading skeletons
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-6 border-b border-gray-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start">
                      <Skeleton className="h-10 w-10 rounded-lg mr-4" />
                      <div>
                        <Skeleton className="h-5 w-40 mb-1" />
                        <Skeleton className="h-4 w-24 mb-2" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    </div>
                    <div className="text-right">
                      <Skeleton className="h-5 w-20 mb-1" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : transactions?.length > 0 ? (
            // Transaction list
            <>
              {transactions.map((transaction: Transaction) => {
                const status = getTransactionStatus(transaction);
                
                return (
                  <div 
                    key={transaction.id} 
                    className="p-4 md:p-6 border-b border-gray-200 hover:bg-gray-50 transition cursor-pointer"
                    onClick={() => setSelectedTransaction(transaction)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start">
                        <div className={`
                          rounded-lg p-2.5 mr-4
                          ${status === TransactionStatus.CLAIMED ? 'bg-green-100' : ''}
                          ${status === TransactionStatus.PENDING ? 'bg-yellow-100' : ''}
                          ${status === TransactionStatus.EXPIRED ? 'bg-gray-100' : ''}
                        `}>
                          {status === TransactionStatus.CLAIMED && <CheckCircle className="h-5 w-5 text-green-600" />}
                          {status === TransactionStatus.PENDING && <Clock className="h-5 w-5 text-yellow-600" />}
                          {status === TransactionStatus.EXPIRED && <Send className="h-5 w-5 text-gray-500" />}
                        </div>
                        <div>
                          <h3 className="font-medium mb-1">Sent to {transaction.recipientEmail}</h3>
                          <p className="text-sm text-gray-500 mb-2">{formatDate(transaction.createdAt)}</p>
                          <div className="flex">
                            <div className={`
                              inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                              ${status === TransactionStatus.CLAIMED ? 'bg-green-100 text-green-800' : ''}
                              ${status === TransactionStatus.PENDING ? 'bg-yellow-100 text-yellow-800' : ''}
                              ${status === TransactionStatus.EXPIRED ? 'bg-gray-100 text-gray-800' : ''}
                            `}>
                              {status === TransactionStatus.CLAIMED && 'Claimed'}
                              {status === TransactionStatus.PENDING && 'Pending'}
                              {status === TransactionStatus.EXPIRED && 'Expired'}
                            </div>
                            
                            {status === TransactionStatus.PENDING && (
                              <button 
                                className="text-xs text-[#00AC6B] hover:underline ml-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTransaction(transaction);
                                  setRegenerateDialogOpen(true);
                                }}
                              >
                                Resend Email
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold mb-1">{transaction.amount} USDC</p>
                        <p className="text-xs text-gray-500">${transaction.amount} USD</p>
                        
                        {status !== TransactionStatus.CLAIMED && (
                          <button 
                            className="mt-2 text-xs text-[#00AC6B] hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTransaction(transaction);
                              setReclaimDialogOpen(true);
                            }}
                          >
                            Reclaim Funds
                          </button>
                        )}
                        
                        {status === TransactionStatus.CLAIMED && transaction.transactionId && (
                          <a
                            href={`https://explorer.algorand.org/tx/${transaction.transactionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-xs text-[#00AC6B] hover:underline inline-flex items-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Transaction <ArrowUpRight className="ml-1 h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            // No transactions
            <div className="p-6 text-center">
              <p className="text-gray-600 mb-4">You haven't sent any USDC yet.</p>
            </div>
          )}
        </Card>
        
        <div className="mt-8 text-center">
          <Button
            className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
            onClick={() => navigate("/send")}
          >
            Send New Transaction
          </Button>
        </div>
      </div>
      
      {/* Reclaim Dialog */}
      <AlertDialog open={reclaimDialogOpen} onOpenChange={setReclaimDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reclaim Funds</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reclaim these funds? This will cancel the transaction and the recipient will no longer be able to claim the USDC.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReclaim}
              disabled={isLoading}
              className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
            >
              Reclaim Funds
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Regenerate Link Dialog */}
      <AlertDialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate Claim Link</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a new claim link and send a new email to the recipient. The previous link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegenerateLink}
              disabled={isLoading}
              className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
            >
              Send New Link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Wallet Modal */}
      <WalletModal isOpen={isWalletModalOpen} setIsOpen={setIsWalletModalOpen} />
    </main>
  );
};

export default Transactions;
