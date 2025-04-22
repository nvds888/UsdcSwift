import React from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, Info } from "lucide-react";

interface WalletModalProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, setIsOpen }) => {
  const { wallets, activeAccount } = useWallet();

  // Close modal if already connected
  React.useEffect(() => {
    if (activeAccount) {
      setIsOpen(false);
    }
  }, [activeAccount, setIsOpen]);

  const handleConnect = async (walletId: string) => {
    const selectedWallet = wallets.find(wallet => wallet.id === walletId);
    if (selectedWallet && !selectedWallet.isConnected) {
      await selectedWallet.connect();
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Connect Your Wallet</DialogTitle>
          <DialogDescription className="text-gray-600">
            Select a wallet to connect to AlgoSend
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 my-6">
          {/* Pera Wallet */}
          <Button
            variant="outline"
            className="w-full justify-between p-6 hover:bg-gray-50"
            onClick={() => handleConnect("pera")}
          >
            <div className="flex items-center">
              <div className="w-8 h-8 mr-3 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="font-semibold text-blue-600">P</span>
              </div>
              <span className="font-medium">Pera Wallet</span>
            </div>
            <span className="text-gray-400">→</span>
          </Button>
          
          {/* Defly Wallet */}
          <Button
            variant="outline"
            className="w-full justify-between p-6 hover:bg-gray-50"
            onClick={() => handleConnect("defly")}
          >
            <div className="flex items-center">
              <div className="w-8 h-8 mr-3 rounded-full bg-purple-100 flex items-center justify-center">
                <span className="font-semibold text-purple-600">D</span>
              </div>
              <span className="font-medium">Defly Wallet</span>
            </div>
            <span className="text-gray-400">→</span>
          </Button>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <Info className="h-5 w-5 text-blue-500" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                You need to have Pera or Defly wallet installed to continue. New to Algorand?{" "}
                <a 
                  href="https://algorand.foundation/ecosystem/about-algorand" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="font-medium underline inline-flex items-center"
                >
                  Learn more
                  <ExternalLink className="h-3 w-3 ml-1" />
                </a>.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WalletModal;
