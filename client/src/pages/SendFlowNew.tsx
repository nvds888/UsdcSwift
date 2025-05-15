import React, { useState } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@txnlab/use-wallet-react";
import { useAlgorand } from "@/hooks/use-algorand";
import { useToast } from "@/hooks/use-toast";
import { TransactionResponse } from "@/lib/types";
import { USDC_ASSET_ID, NETWORK } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ArrowLeft, Check, Clock, ExternalLink, Info } from "lucide-react";
import WalletModal from "@/components/WalletModal";

// Form validation schema
const sendSchema = z.object({
  amount: z.string()
    .min(1, "Amount is required")
    .refine(val => !isNaN(parseFloat(val)), "Amount must be a number")
    .refine(val => parseFloat(val) > 0, "Amount must be greater than 0"),
  recipientEmail: z.string().email("Valid email address is required"),
  note: z.string().max(150, "Note must be 150 characters or less").optional(),
});

type FormValues = z.infer<typeof sendSchema>;

const SendFlowNew: React.FC = () => {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeAccount, wallets } = useWallet();
  const { balance, sendUsdc, isLoading } = useAlgorand();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<"amount" | "recipient" | "confirm" | "success">("amount");
  const [transaction, setTransaction] = useState<TransactionResponse | null>(null);
  const [checkingStatus, setCheckingStatus] = useState<boolean>(false);
  
  // Initialize form
  const form = useForm<FormValues>({
    resolver: zodResolver(sendSchema),
    defaultValues: {
      amount: "",
      recipientEmail: "",
      note: "",
    },
    mode: "onChange",
  });
  
  // Debug form validation
  console.log("Form validation state:", { 
    isValid: form.formState.isValid,
    errors: form.formState.errors,
    values: form.getValues(),
    dirtyFields: form.formState.dirtyFields
  });

  // Prompt user to connect wallet if not connected
  React.useEffect(() => {
    if (!activeAccount && currentStep !== "success") {
      setIsWalletModalOpen(true);
    }
  }, [activeAccount, currentStep]);

  // Handle quick amount selection
  const handleQuickAmount = (amount: string) => {
    form.setValue("amount", amount);
    form.trigger("amount");
  };
  
  // Manual advance step function
  const advanceToNextStep = () => {
    if (currentStep === "amount") {
      const amountValue = form.getValues("amount");
      if (amountValue && !isNaN(parseFloat(amountValue)) && parseFloat(amountValue) > 0) {
        setCurrentStep("recipient");
      } else {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
      }
    } else if (currentStep === "recipient") {
      const email = form.getValues("recipientEmail");
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setCurrentStep("confirm");
      } else {
        toast({
          title: "Invalid Email",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
      }
    }
  };

  // Handle form submission
  const onSubmit = async (data: FormValues) => {
    console.log("Form submitted with data:", data);
    
    if (!activeAccount) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet to proceed",
        variant: "destructive",
      });
      setIsWalletModalOpen(true);
      return;
    }

    try {
      // Only attempt to send if we're on the confirm step
      if (currentStep === "confirm") {
        // Send USDC
        const response = await sendUsdc({
          recipientEmail: data.recipientEmail,
          amount: data.amount,
          note: data.note,
          senderAddress: activeAccount.address,
        });
        
        if (response) {
          setTransaction(response);
          setCurrentStep("success");
        }
      }
    } catch (error) {
      console.error("Error sending USDC:", error);
      toast({
        title: "Error",
        description: "Failed to send USDC. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleBack = () => {
    if (currentStep === "recipient") {
      setCurrentStep("amount");
    } else if (currentStep === "confirm") {
      setCurrentStep("recipient");
    }
  };

  const handleSendAnother = () => {
    form.reset();
    setCurrentStep("amount");
    setTransaction(null);
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

  return (
    <main className="flex-grow container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Step Indicator */}
        {currentStep !== "success" && (
          <div className="stepper mb-8 hidden md:flex items-center justify-center">
            <div className="step-item flex items-center">
              <div className={`step-circle flex items-center justify-center h-8 w-8 rounded-full ${currentStep === "amount" ? "bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] text-white" : "bg-gray-200 text-gray-700"} font-medium`}>
                1
              </div>
              <div className={`step-title ml-2 text-sm font-medium ${currentStep === "amount" ? "text-gray-800" : "text-gray-500"}`}>
                Enter Amount
              </div>
            </div>
            <div className="divider w-16 h-[1px] bg-gray-200 mx-4"></div>
            <div className="step-item flex items-center">
              <div className={`step-circle flex items-center justify-center h-8 w-8 rounded-full ${currentStep === "recipient" ? "bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] text-white" : "bg-gray-200 text-gray-700"} font-medium`}>
                2
              </div>
              <div className={`step-title ml-2 text-sm font-medium ${currentStep === "recipient" ? "text-gray-800" : "text-gray-500"}`}>
                Recipient Details
              </div>
            </div>
            <div className="divider w-16 h-[1px] bg-gray-200 mx-4"></div>
            <div className="step-item flex items-center">
              <div className={`step-circle flex items-center justify-center h-8 w-8 rounded-full ${currentStep === "confirm" ? "bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] text-white" : "bg-gray-200 text-gray-700"} font-medium`}>
                3
              </div>
              <div className={`step-title ml-2 text-sm font-medium ${currentStep === "confirm" ? "text-gray-800" : "text-gray-500"}`}>
                Confirm & Send
              </div>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Amount Step */}
            {currentStep === "amount" && (
              <Card>
                <CardContent className="p-6 md:p-8">
                  <h2 className="text-2xl font-semibold mb-4">Send USDC</h2>

                  <p className="text-gray-600 mb-6">Enter the amount you want to send.</p>
                  
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className="mb-8">
                        <FormLabel>Amount (USDC)</FormLabel>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500">$</span>
                          </div>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step="0.01"
                              min="0.01"
                              placeholder="0.00"
                              className="pl-8 pr-12"
                            />
                          </FormControl>
                          <div className="absolute inset-y-0 right-0 flex items-center">
                            <span className="text-gray-500 mr-4">USDC</span>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-gray-500">Your balance: {balance} USDC</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Quick amounts</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleQuickAmount("10")}
                      >
                        $10
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleQuickAmount("25")}
                      >
                        $25
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleQuickAmount("50")}
                      >
                        $50
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleQuickAmount("100")}
                      >
                        $100
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => navigate("/")}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                      disabled={!activeAccount}
                      onClick={advanceToNextStep}
                    >
                      Continue
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recipient Step */}
            {currentStep === "recipient" && (
              <Card>
                <CardContent className="p-6 md:p-8">
                  <h2 className="text-2xl font-semibold mb-6">Recipient Details</h2>
                  <p className="text-gray-600 mb-8">Enter the recipient's email address and add an optional note.</p>
                  
                  <FormField
                    control={form.control}
                    name="recipientEmail"
                    render={({ field }) => (
                      <FormItem className="mb-6">
                        <FormLabel>Recipient Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            placeholder="name@example.com"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem className="mb-8">
                        <FormLabel>
                          Add a note (optional)
                          <span className="text-gray-500 text-xs ml-1">Max 150 characters</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Add a personal message to the recipient..."
                            rows={3}
                            maxLength={150}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="flex justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleBack}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button
                      type="button"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                      onClick={advanceToNextStep}
                    >
                      Continue
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Confirm Step */}
            {currentStep === "confirm" && (
              <Card>
                <CardContent className="p-6 md:p-8">
                  <h2 className="text-2xl font-semibold mb-6">Confirm & Send</h2>
                  <p className="text-gray-600 mb-8">Review the transaction details before sending.</p>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-8">
                    <div className="flex justify-between mb-4">
                      <span className="text-gray-600">Amount:</span>
                      <span className="font-medium">{form.getValues("amount")} USDC</span>
                    </div>
                    <div className="flex justify-between mb-4">
                      <span className="text-gray-600">Recipient:</span>
                      <span className="font-medium">{form.getValues("recipientEmail")}</span>
                    </div>
                    {form.getValues("note") && (
                      <div className="mb-4">
                        <span className="text-gray-600 block mb-2">Note:</span>
                        <div className="bg-white p-3 rounded border border-gray-200 text-sm">
                          {form.getValues("note")}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Sender:</span>
                      <span className="font-medium">{activeAccount?.address.slice(0, 8)}...{activeAccount?.address.slice(-8)}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleBack}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <Button
                      type="submit"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                      disabled={isLoading}
                    >
                      {isLoading ? "Sending..." : "Send USDC"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Success Step */}
            {currentStep === "success" && transaction && (
              <Card>
                <CardContent className="p-6 md:p-8 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Check className="h-8 w-8 text-green-600" />
                  </div>
                  <h2 className="text-2xl font-semibold mb-4">USDC Sent Successfully!</h2>
                  <p className="text-gray-600 mb-8">
                    You've sent {transaction.amount} USDC to {transaction.recipientEmail}. They will receive an email with instructions to claim it.
                  </p>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-8 text-left">
                    <div className="flex justify-between mb-4">
                      <span className="text-gray-600">Amount:</span>
                      <span className="font-medium">{transaction.amount} USDC</span>
                    </div>
                    <div className="flex justify-between mb-4">
                      <span className="text-gray-600">Recipient:</span>
                      <span className="font-medium">{transaction.recipientEmail}</span>
                    </div>
                    <div className="flex justify-between mb-4">
                      <span className="text-gray-600">Created:</span>
                      <span className="font-medium">{formatDate(transaction.createdAt)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-gray-600">Status:</span>
                      {transaction.status === 'funded' ? (
                        <span className="inline-flex items-center">
                          <Check className="h-4 w-4 text-green-500 mr-1" />
                          <span className="text-green-700 font-medium">Funded</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center">
                          <Clock className="h-4 w-4 text-yellow-500 mr-1" />
                          <span className="text-yellow-700 font-medium">Pending</span>
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Smart Contract:</span>
                      <a
                        href={`https://testnet.algoexplorer.io/address/${transaction.appAddress || ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 flex items-center"
                      >
                        {transaction.appAddress ? `${transaction.appAddress.slice(0, 6)}...${transaction.appAddress.slice(-4)}` : 'Pending...'}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </div>
                  </div>
                  
                  <div className="flex flex-col md:flex-row gap-4 justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate("/transactions")}
                      className="w-full md:w-auto"
                    >
                      View Transactions
                    </Button>
                    <Button
                      type="button"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white w-full md:w-auto"
                      onClick={handleSendAnother}
                    >
                      Send Another
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </form>
        </Form>
      </div>
      
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        wallets={wallets}
      />
    </main>
  );
};

export default SendFlowNew;