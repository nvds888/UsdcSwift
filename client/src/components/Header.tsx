import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useWallet } from "@txnlab/use-wallet-react";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Send, Wallet, LogOut } from "lucide-react";

const Header: React.FC = () => {
  const { activeAccount, activeWallet, wallets } = useWallet();
  
  const truncateAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };
  
  const handleDisconnect = async () => {
    if (activeWallet) {
      await activeWallet.disconnect();
    }
  };

  return (
    <header className="bg-white shadow-sm">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/">
          <div className="flex items-center space-x-2 cursor-pointer">
            <div className="h-8 w-8 rounded-md bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] flex items-center justify-center">
              <Send className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-gray-800">AlgoSend</h1>
          </div>
        </Link>
        
        <div className="flex items-center space-x-4">
          {activeAccount ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex items-center space-x-2">
                  <div className="h-2 w-2 rounded-full bg-[#00AC6B]" />
                  <span className="text-sm hidden md:inline">{truncateAddress(activeAccount.address)}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/transactions">
                    <div className="flex items-center cursor-pointer w-full">
                      <Send className="mr-2 h-4 w-4" />
                      <span>My Transactions</span>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDisconnect}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Disconnect</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button 
              variant="outline" 
              className="hidden md:flex items-center"
              asChild
            >
              <Link href="/connect">
                <Wallet className="mr-2 h-4 w-4" />
                <span>Connect Wallet</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
