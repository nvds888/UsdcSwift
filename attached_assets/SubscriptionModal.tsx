"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Crown, Star, Clock, Calendar, DollarSign, ExternalLink, Zap, Copy, LogOut, Wallet, CreditCard } from 'lucide-react';
import { useWallet, WalletProvider, WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';

const walletManager = new WalletManager({
  wallets: [WalletId.PERA, WalletId.DEFLY],
  defaultNetwork: NetworkId.TESTNET
});

const USDC_ASSET_ID = 10458941; // Move to env/config
const MERCHANT_ADDRESS = 'MQYGWBVAXQHTOFWTF4KZZ3EAP6L45NCGG7JQCBH3622FVEX57WGAR7DJEI'; // Move to env/config

interface SubscriptionPlan {
  price: number;
  duration: string;
  savings: number;
}

interface SubscriptionPlans {
  [key: string]: SubscriptionPlan;
}

// New interface for top-up options
interface TopUpOption {
  spots: number;
  price: number;
}

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  isPremium: boolean;
  spotsRemaining?: number;
  subscriptionDetails?: {
    startDate?: string;
    endDate?: string;
    plan?: string;
    transactionId?: string;
    walletAddress?: string;
  };
}

interface SubscriptionButtonProps {
  userId: string;
  isPremium: boolean;
  spotsRemaining: number;
  subscriptionEndDate?: string;
  subscriptionDetails?: SubscriptionModalProps['subscriptionDetails'];
}

const subscriptionPlans: SubscriptionPlans = {
  '3': { price: 19.99, duration: '3 months', savings: 0 },
  '6': { price: 34.99, duration: '6 months', savings: 5 },
  '12': { price: 59.99, duration: '12 months', savings: 20 }
};

// Top-up options array
const topUpOptions: TopUpOption[] = [
  { spots: 2, price: 0.20 },
  { spots: 5, price: 0.50 },
  { spots: 10, price: 1.00 }
];

const ModalContent: React.FC<SubscriptionModalProps> = ({ 
  isOpen, 
  onClose, 
  userId, 
  isPremium, 
  spotsRemaining,
  subscriptionDetails 
}) => {
  const { activeAddress, transactionSigner, algodClient, wallets } = useWallet();
  const [selectedDuration, setSelectedDuration] = useState<string>('3');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [transactionId, setTransactionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'subscription' | 'topup'>(isPremium ? 'topup' : 'subscription');
  const [showWalletOptions, setShowWalletOptions] = useState<boolean>(false);
  const [showAddressMenu, setShowAddressMenu] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  
  // Top-up related state
  const [selectedTopUpOption, setSelectedTopUpOption] = useState<number>(2); // Default to 2 spots
  const [isProcessingTopUp, setIsProcessingTopUp] = useState<boolean>(false);
  const [topUpError, setTopUpError] = useState<string>('');
  const [topUpStatus, setTopUpStatus] = useState<string>('');

  // Refs for clicking outside
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const addressMenuRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // More robust check for valid subscription details
  const hasValidSubscriptionDetails = 
    subscriptionDetails && 
    subscriptionDetails.startDate && 
    subscriptionDetails.endDate && 
    subscriptionDetails.plan &&
    new Date(subscriptionDetails.endDate) > new Date(); 

  // Calculate duration in months if premium and plans are valid
  const durationInMonths = hasValidSubscriptionDetails ? parseInt(subscriptionDetails.plan!) : null;
  const pricePaid = durationInMonths && subscriptionPlans[subscriptionDetails!.plan!] ? 
    subscriptionPlans[subscriptionDetails!.plan!].price : null;

  // Close menu when clicking outside or pressing escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target as Node)) {
        setShowWalletOptions(false);
      }
      if (addressMenuRef.current && !addressMenuRef.current.contains(event.target as Node)) {
        setShowAddressMenu(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Copy wallet address to clipboard
  const copyWalletAddress = () => {
    if (activeAddress) {
      navigator.clipboard.writeText(activeAddress)
        .then(() => {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
        })
        .catch(err => console.error('Failed to copy: ', err));
    }
    setShowAddressMenu(false);
  };

  // Handle wallet disconnect
  const handleDisconnect = () => {
    const connectedWallet = wallets.find(wallet => wallet.isConnected);
    if (connectedWallet) {
      connectedWallet.disconnect();
    }
    setShowAddressMenu(false);
  };

  const handleSubscribe = async () => {
    if (!activeAddress || !transactionSigner || !algodClient) {
      setError('Please connect your wallet first');
      return;
    }
  
    try {
      setIsProcessing(true);
      setError('');
      setProcessingStatus('Preparing transaction...');
  
      const amount = subscriptionPlans[selectedDuration].price;
      const amountInMicroUsdc = Math.round(amount * 1_000_000); // Ensure integer amount
      const suggestedParams = await algodClient.getTransactionParams().do();
  
      // Add note with user ID for tracking
      const note = algosdk.encodeObj({ userId: userId, plan: selectedDuration });
  
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: MERCHANT_ADDRESS,
        amount: amountInMicroUsdc,
        assetIndex: USDC_ASSET_ID,
        note: note,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });
  
      // Sign and submit transaction
      const atc = new algosdk.AtomicTransactionComposer();
      atc.addTransaction({ txn, signer: transactionSigner });
  
      setProcessingStatus('Sending transaction...');
      const result = await atc.execute(algodClient, 4);
      const txId = result.txIDs[0];
      setTransactionId(txId);
      console.log("Transaction submitted:", txId);
  
      // Wait for blockchain confirmation
      setProcessingStatus('Waiting for blockchain confirmation...');
      const confirmedTx = await algosdk.waitForConfirmation(algodClient, txId, 4);
      console.log("Transaction confirmed in round:", confirmedTx.confirmedRound);
  
      // Notify backend after confirmation
      setProcessingStatus('Updating subscription...');
      const confirmResponse = await fetch('https://plane-spotter-backend.onrender.com/api/subscription/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          duration: selectedDuration,
          txId,
          walletAddress: activeAddress,
        }),
      });
  
      if (!confirmResponse.ok) {
        throw new Error('Failed to update subscription on server');
      }
  
      const data = await confirmResponse.json();
      if (!data.success) {
        throw new Error(data.error || 'Subscription confirmation failed');
      }
  
      // Success
      setProcessingStatus('Success! Refreshing page...');
      sessionStorage.setItem('fromPremiumOffer', 'true');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1000);
  
    } catch (error) {
      console.error("Subscription error:", error);
      setError(error instanceof Error ? error.message : 'Failed to subscribe');
      setIsProcessing(false);
    }
  };

  // Add handle topup function
  const handleTopUp = async () => {
    if (!activeAddress || !transactionSigner || !algodClient) {
      setTopUpError('Please connect your wallet first');
      return;
    }
  
    try {
      setIsProcessingTopUp(true);
      setTopUpError('');
      setTopUpStatus('Preparing transaction...');
  
      // Find the selected option
      const option = topUpOptions.find(opt => opt.spots === selectedTopUpOption);
      if (!option) {
        throw new Error('Invalid top-up option');
      }
  
      const amountInMicroUsdc = Math.round(option.price * 1_000_000); // Convert to micro USDC
      const suggestedParams = await algodClient.getTransactionParams().do();
  
      // Add note with user ID and top-up details for tracking
      const note = algosdk.encodeObj({ userId: userId, topUp: true, spots: option.spots });
  
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: MERCHANT_ADDRESS,
        amount: amountInMicroUsdc,
        assetIndex: USDC_ASSET_ID,
        note: note,
        suggestedParams: { ...suggestedParams, fee: 1000, flatFee: true },
      });
  
      // Sign and submit transaction
      const atc = new algosdk.AtomicTransactionComposer();
      atc.addTransaction({ txn, signer: transactionSigner });
  
      setTopUpStatus('Sending transaction...');
      const result = await atc.execute(algodClient, 4);
      const txId = result.txIDs[0];
      setTransactionId(txId);
      console.log("Top-up transaction submitted:", txId);
  
      // Wait for blockchain confirmation
      setTopUpStatus('Waiting for blockchain confirmation...');
      const confirmedTx = await algosdk.waitForConfirmation(algodClient, txId, 4);
      console.log("Transaction confirmed in round:", confirmedTx.confirmedRound);
  
      // Notify backend after confirmation
      setTopUpStatus('Updating top-up...');
      const confirmResponse = await fetch('https://plane-spotter-backend.onrender.com/api/topup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          spots: option.spots,
          txId,
          walletAddress: activeAddress,
        }),
      });
  
      if (!confirmResponse.ok) {
        throw new Error('Failed to update top-up on server');
      }
  
      const data = await confirmResponse.json();
      if (!data.success) {
        throw new Error(data.error || 'Top-up confirmation failed');
      }
  
      // Success
      setTopUpStatus('Success! Refreshing page...');
      sessionStorage.setItem('fromTopUp', 'true');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1000);
  
    } catch (error) {
      console.error("Top-up error:", error);
      setTopUpError(error instanceof Error ? error.message : 'Failed to process top-up');
      setIsProcessingTopUp(false);
    }
  };

  // Render wallet options popup
  const renderWalletOptions = () => {
    return (
      <div 
        ref={walletMenuRef}
        className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg z-50 w-64 overflow-hidden"
      >
        <div className="p-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">Connect Wallet</h3>
        </div>
        <div className="p-2">
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => {
                wallet.connect().catch((err) => setError(err.message || 'Failed to connect'));
                setShowWalletOptions(false);
              }}
              disabled={wallet.isConnected}
              className="w-full bg-white hover:bg-gray-50 py-3 px-4 rounded-lg flex items-center justify-between disabled:opacity-50 mb-1"
            >
              <div className="flex items-center gap-2">
                <img src={wallet.metadata.icon} alt={wallet.metadata.name} className="w-6 h-6" />
                <span>{wallet.metadata.name}</span>
              </div>
              {wallet.isConnected && <Check size={16} className="text-green-500" />}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Render wallet address menu popup
  const renderAddressMenu = () => {
    return (
      <div 
        ref={addressMenuRef}
        className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg z-50 w-64 overflow-hidden"
      >
        <div className="p-1">
          <button
            onClick={copyWalletAddress}
            className="w-full text-left px-4 py-3 hover:bg-gray-50 rounded-lg flex items-center gap-2"
          >
            <Copy size={16} />
            <span>{copySuccess ? 'Copied!' : 'Copy Address'}</span>
          </button>
          <button
            onClick={handleDisconnect}
            className="w-full text-left px-4 py-3 hover:bg-gray-50 rounded-lg flex items-center gap-2 text-red-500"
          >
            <LogOut size={16} />
            <span>Disconnect</span>
          </button>
        </div>
      </div>
    );
  };

  // Renders the subscription content for active premium users
  const renderActiveSubscription = () => (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-purple-500 to-blue-500 text-white p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Crown size={20} />
          <h3 className="font-semibold">Your Active Subscription</h3>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Calendar size={16} />
            <span>
              Start: {new Date(subscriptionDetails!.startDate!).toLocaleDateString()}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Calendar size={16} />
            <span>
              End: {new Date(subscriptionDetails!.endDate!).toLocaleDateString()}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Clock size={16} />
            <span>Duration: {subscriptionPlans[subscriptionDetails!.plan!].duration}</span>
          </li>
          {pricePaid && (
            <li className="flex items-center gap-2">
              <DollarSign size={16} />
              <span>Price Paid: ${pricePaid} USDC</span>
            </li>
          )}
          {subscriptionDetails?.transactionId && (
            <li className="flex items-center gap-2">
              <ExternalLink size={16} />
              <a
                href={`https://testnet.explorer.perawallet.app/tx/${subscriptionDetails.transactionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-200"
              >
                Transaction: {subscriptionDetails.transactionId.slice(0, 8)}...
              </a>
            </li>
          )}
        </ul>
      </div>
    </div>
  );

  // Renders subscription upgrade content
  const renderSubscriptionTab = () => {
    if (hasValidSubscriptionDetails) {
      return renderActiveSubscription();
    }
    
    return (
      <div className="space-y-4">
        <div className="bg-gradient-to-r from-purple-500 to-blue-500 text-white p-4 rounded-xl mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Crown size={20} />
            <h3 className="font-semibold">Premium Benefits</h3>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <Check size={16} />
              <span>6 spots per day (Free: 3 spots)</span>
            </li>
            <li className="flex items-center gap-2">
              <Check size={16} />
              <span>Advanced insights and analytics</span>
            </li>
            <li className="flex items-center gap-2">
              <Check size={16} />
              <span>Unlimited AI calls</span>
            </li>
          </ul>
        </div>

        {!isProcessing && !isProcessingTopUp && (
          <select
            value={selectedDuration}
            onChange={(e) => setSelectedDuration(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.entries(subscriptionPlans).map(([duration, plan]) => (
              <option key={duration} value={duration}>
                {plan.duration} - ${plan.price}
                {plan.savings > 0 ? ` (Save $${plan.savings})` : ''}
              </option>
            ))}
          </select>
        )}

        <div className="space-y-3">
          {isProcessing ? (
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="flex justify-center mb-3">
                <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              </div>
              <p className="text-blue-700">{processingStatus}</p>
              {transactionId && (
                <a 
                  href={`https://testnet.explorer.perawallet.app/tx/${transactionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 underline mt-2 inline-block"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <button
              onClick={handleSubscribe}
              disabled={!activeAddress}
              className={`w-full ${activeAddress ? 'bg-indigo-400 hover:bg-indigo-500' : 'bg-gray-300 cursor-not-allowed'} text-white py-3 rounded-xl flex items-center justify-center gap-2`}
            >
              <CreditCard size={18} />
              <span>Confirm Subscription</span>
            </button>
          )}
          
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          
          {transactionId && !isProcessing && (
            <a 
              href={`https://testnet.explorer.perawallet.app/tx/${transactionId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 underline text-center block"
            >
              View transaction ({transactionId.slice(0, 8)}...)
            </a>
          )}
        </div>
      </div>
    );
  };

  // Renders top-up content
  const renderTopUpTab = () => (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-amber-400 to-amber-600 text-white p-4 rounded-xl mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={20} />
          <h3 className="font-semibold">Spot Top-up</h3>
        </div>
        <p className="text-sm">
          {spotsRemaining !== undefined && spotsRemaining <= 0 
            ? "You've used all your spots for today! Add more to continue spotting."
            : "Need more spots? Add some instantly."}
        </p>
      </div>

      {!isProcessingTopUp && (
        <select
          value={selectedTopUpOption}
          onChange={(e) => setSelectedTopUpOption(parseInt(e.target.value))}
          className="w-full p-3 border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white mb-3"
        >
          {topUpOptions.map((option) => (
            <option key={option.spots} value={option.spots}>
              {option.spots} spots - ${option.price.toFixed(2)} USDC
            </option>
          ))}
        </select>
      )}

      <div className="space-y-3">
        {isProcessingTopUp ? (
          <div className="bg-amber-50 rounded-xl p-4 text-center">
            <div className="flex justify-center mb-3">
              <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
            <p className="text-amber-700">{topUpStatus}</p>
            {transactionId && (
              <a 
                href={`https://testnet.explorer.perawallet.app/tx/${transactionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-500 underline mt-2 inline-block"
              >
                View transaction
              </a>
            )}
          </div>
        ) : (
          <button
            onClick={handleTopUp}
            disabled={!activeAddress}
            className={`w-full ${activeAddress ? 'bg-amber-500 hover:bg-amber-600' : 'bg-amber-300 cursor-not-allowed'} text-white py-3 rounded-xl flex items-center justify-center gap-2`}
          >
            <Zap size={18} />
            <span>Buy Spots Now</span>
          </button>
        )}
        
        {topUpError && <p className="text-red-500 text-sm text-center">{topUpError}</p>}
        
        {transactionId && !isProcessingTopUp && (
          <a 
            href={`https://testnet.explorer.perawallet.app/tx/${transactionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-500 underline text-center block"
          >
            View transaction ({transactionId.slice(0, 8)}...)
          </a>
        )}
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end justify-center z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            ref={modalRef}
            className="bg-gradient-to-b from-white to-blue-50 rounded-t-2xl max-w-lg w-full"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with wallet connection */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                {isPremium ? 'Your Premium Subscription' : 'Upgrade to Premium'}
              </h2>
              <div className="flex items-center gap-2 relative">
                {!activeAddress ? (
                  <button 
                    onClick={() => setShowWalletOptions(!showWalletOptions)}
                    className="flex items-center gap-1.5 py-1.5 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    <Wallet size={16} />
                    <span>Connect</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => setShowAddressMenu(!showAddressMenu)}
                    className="flex items-center gap-1.5 py-1.5 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    <span>{activeAddress.slice(0, 4)}...{activeAddress.slice(-4)}</span>
                  </button>
                )}
                
                <button 
                  onClick={onClose} 
                  className="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 hover:bg-gray-50 transition-colors"
                  aria-label="Close"
                >
                  <X size={18} className="text-gray-500" />
                </button>
                
                {showWalletOptions && renderWalletOptions()}
                {showAddressMenu && renderAddressMenu()}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setActiveTab('subscription')}
                className={`flex-1 py-3 px-4 text-center font-medium ${
                  activeTab === 'subscription' 
                    ? 'text-blue-600 border-b-2 border-blue-600' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <CreditCard size={16} />
                  <span>Subscription</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab('topup')}
                className={`flex-1 py-3 px-4 text-center font-medium ${
                  activeTab === 'topup' 
                    ? 'text-amber-600 border-b-2 border-amber-600' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <Zap size={16} />
                  <span>Top-up</span>
                </div>
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {activeTab === 'subscription' ? renderSubscriptionTab() : renderTopUpTab()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const SubscriptionModal: React.FC<SubscriptionModalProps & {externalProvider?: boolean}> = (props) => {
  // Use external provider if specified, otherwise use internal one
  if (props.externalProvider) {
    return <ModalContent {...props} />;
  }

  return (
    <WalletProvider manager={walletManager}>
      <ModalContent {...props} />
    </WalletProvider>
  );
};

export const SubscriptionButton: React.FC<SubscriptionButtonProps> = ({ 
  userId, 
  isPremium, 
  spotsRemaining,
  subscriptionEndDate, 
  subscriptionDetails 
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`px-3 py-1.5 bg-gradient-to-r ${spotsRemaining <= 0 ? 'from-amber-500 to-orange-500' : 'from-purple-500 to-blue-500'} text-white rounded-lg 
          hover:${spotsRemaining <= 0 ? 'from-amber-600 to-orange-600' : 'from-purple-600 to-blue-600'} transition-all flex items-center gap-1.5 text-sm`}
        title={subscriptionEndDate ? `Expires: ${new Date(subscriptionEndDate).toLocaleDateString()}` : undefined}
      >
        {isPremium ? (
          <>
            <Crown className="w-4 h-4" />
            <span>Premium</span>
          </>
        ) : spotsRemaining <= 0 ? (
          <>
            <Zap className="w-4 h-4" />
            <span>Top-up</span>
          </>
        ) : (
          <>
            <Star className="w-4 h-4" />
            <span>Upgrade</span>
          </>
        )}
      </button>
      
      <SubscriptionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userId={userId}
        isPremium={isPremium}
        spotsRemaining={spotsRemaining}
        subscriptionDetails={subscriptionDetails}
      />
    </>
  );
};

export default SubscriptionModal;