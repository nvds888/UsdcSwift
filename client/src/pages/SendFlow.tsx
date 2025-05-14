import React, { useState } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@txnlab/use-wallet-react";
import { useAlgorand } from "@/hooks/use-algorand";
import { useToast } from "@/hooks/use-toast";
import { TransactionResponse } from "@/lib/types";
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
import { ArrowLeft, Check, Clock, ExternalLink } from "lucide-react";
import WalletModal from "@/components/WalletModal";

// Form validation schema
const sendSchema = z.object({
  amount: z.string()
    .min(1, "Amount is required")
    .refine(val => !isNaN(parseFloat(val)), "Amount must be a number")
    .refine(val => parseFloat(val) > 0, "Amount must be greater than 0")
    .refine(val => parseFloat(val) <= 184, "Amount cannot exceed your balance"),
  recipientEmail: z.string().email("Valid email address is required"),
  note: z.string().max(150, "Note must be 150 characters or less").optional(),
});

type FormValues = z.infer<typeof sendSchema>;

const SendFlow: React.FC = () => {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeAccount } = useWallet();
  const { balance, sendUsdc, isLoading } = useAlgorand();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<"amount" | "recipient" | "confirm" | "success">("amount");
  const [transaction, setTransaction] = useState<TransactionResponse | null>(null);
  
  // Initialize form
  const form = useForm<FormValues>({
    resolver: zodResolver(sendSchema),
    defaultValues: {
      amount: "",
      recipientEmail: "",
      note: "",
    },
    mode: "onChange", // Validate on change to provide immediate feedback
  });
  
  // Debug form validation
  const formState = form.formState;
  console.log("Form validation state:", { 
    isValid: formState.isValid,
    errors: formState.errors,
    values: form.getValues(),
    dirtyFields: formState.dirtyFields
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
    
    // Force validation before proceeding
    const isValid = await form.trigger();
    if (!isValid) {
      console.log("Form validation failed:", form.formState.errors);
      return;
    }

    // If we're not on the confirmation step yet, just advance to next step
    if (currentStep === "amount") {
      setCurrentStep("recipient");
      return;
    }
    
    if (currentStep === "recipient") {
      setCurrentStep("confirm");
      return;
    }

    // On confirm step, actually submit the transaction
    try {
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
            <div className="step-separator w-16 h-1 mx-4 bg-gray-200"></div>
            <div className="step-item flex items-center">
              <div className={`step-circle flex items-center justify-center h-8 w-8 rounded-full ${currentStep === "recipient" ? "bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] text-white" : "bg-gray-200 text-gray-700"} font-medium`}>
                2
              </div>
              <div className={`step-title ml-2 text-sm font-medium ${currentStep === "recipient" ? "text-gray-800" : "text-gray-500"}`}>
                Recipient Details
              </div>
            </div>
            <div className="step-separator w-16 h-1 mx-4 bg-gray-200"></div>
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
                  <h2 className="text-2xl font-semibold mb-6">Send USDC to an email</h2>
                  <p className="text-gray-600 mb-8">Choose the amount of USDC to send to a recipient via email. They'll receive a link to claim the funds securely.</p>
                  
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
                              onChange={(e) => {
                                // Update the field value
                                field.onChange(e);
                                // Trigger validation
                                form.trigger("amount");
                              }}
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
                      type="submit"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                      disabled={!form.formState.isValid || !activeAccount}
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
                        <FormLabel>Email Address</FormLabel>
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
                      type="submit"
                      className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                      disabled={!form.formState.isValid || !activeAccount}
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
                  <p className="text-gray-600 mb-8">Review the details before sending USDC to the recipient.</p>
                  
                  <div className="mb-8 bg-gray-50 rounded-xl p-5 border border-gray-200">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-sm text-gray-500">Amount</span>
                      <span className="font-semibold text-lg">${form.getValues("amount")} USDC</span>
                    </div>
                    <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                      <span className="text-sm text-gray-500">Recipient</span>
                      <span className="font-medium">{form.getValues("recipientEmail")}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-500">Transaction Fee</span>
                      <span className="font-medium text-sm">0.001 ALGO (~$0.0004)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">Network</span>
                      <div className="flex items-center">
                        <div className="h-2 w-2 rounded-full bg-[#00AC6B] mr-1.5"></div>
                        <span className="font-medium text-sm">Algorand</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <Info className="h-5 w-5 text-blue-500" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-blue-700">
                          The recipient will receive an email with a secure link to claim their USDC. Unclaimed funds can be reclaimed by you at any time.
                        </p>
                      </div>
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
                      disabled={isLoading || !activeAccount}
                    >
                      Send USDC
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </form>
        </Form>

        {/* Success Step */}
        {currentStep === "success" && transaction && (
          <Card>
            <CardContent className="p-6 md:p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-20 w-20 rounded-full bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] flex items-center justify-center">
                  <Check className="h-10 w-10 text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-4">Success!</h2>
              <p className="text-gray-600 mb-8">
                You've successfully sent <span className="font-semibold">${transaction.amount} USDC</span> to <span className="font-semibold">{transaction.recipientEmail}</span>
              </p>
              
              <div className="bg-gray-50 rounded-lg p-5 mb-8 text-left">
                <h3 className="font-medium mb-3">Transaction details</h3>
                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Transaction ID</span>
                    <span className="font-medium truncate ml-4">{transaction.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Smart Contract</span>
                    <span className="font-medium truncate ml-4">{transaction.smartContractAddress}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Date & Time</span>
                    <span className="font-medium">{formatDate(transaction.createdAt)}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col md:flex-row justify-center gap-4">
                <Button
                  variant="outline"
                  onClick={() => navigate("/transactions")}
                >
                  View My Transactions
                </Button>
                <Button
                  className="bg-gradient-to-r from-[#00AC6B] to-[#3CC8C8] hover:opacity-90 text-white"
                  onClick={handleSendAnother}
                >
                  Send Another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Wallet Modal */}
      <WalletModal 
        isOpen={isWalletModalOpen} 
        onClose={() => setIsWalletModalOpen(false)} 
        wallets={useWallet().wallets}
      />
    </main>
  );
};

// Helper component for Info icon
const Info: React.FC<{ className?: string }> = (props) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export default SendFlow;
