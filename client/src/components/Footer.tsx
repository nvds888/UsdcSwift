import React from "react";
import { Send } from "lucide-react";

const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-gray-200 py-6">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <div className="flex items-center space-x-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] flex items-center justify-center">
                <Send className="h-3 w-3 text-white" />
              </div>
              <span className="text-sm font-medium text-gray-800">AlgoSend</span>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Terms</a>
            <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Privacy</a>
            <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Help</a>
            <div className="flex items-center space-x-3">
              <div className="h-1.5 w-1.5 rounded-full bg-[#00AC6B]" />
              <span className="text-xs font-medium text-gray-700">
                Algorand {process.env.NODE_ENV === "production" ? "Mainnet" : "Testnet"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
