import React from "react";
import { Link } from "wouter";
import { Send } from "lucide-react";
import ConnectWallet from "@/components/ConnectWallet";

const Header: React.FC = () => {
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
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
};

export default Header;