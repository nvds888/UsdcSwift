import { useState } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import WalletModal from "./WalletModal";
import { Link } from "wouter";

export function ConnectWallet() {
  const { wallets, activeAccount, activeWallet } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  const handleDisconnect = async () => {
    if (activeWallet) {
      await activeWallet.disconnect();
    }
  };

  const truncateAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <>
      {activeAccount ? (
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={handleDisconnect}
          >
            <Wallet className="h-4 w-4" />
            <span>{truncateAddress(activeAccount.address)}</span>
          </Button>
          <Link href="/transactions">
            <Button variant="link" size="sm">My Transactions</Button>
          </Link>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={openModal}
        >
          <Wallet className="h-4 w-4" />
          <span>Connect</span>
        </Button>
      )}
      <WalletModal wallets={wallets} isOpen={isModalOpen} onClose={closeModal} />
    </>
  );
}

export default ConnectWallet;