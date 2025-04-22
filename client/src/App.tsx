import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { WalletProvider, WalletManager } from "@txnlab/use-wallet-react";
import NotFound from "@/pages/not-found";
import SendFlow from "@/pages/SendFlow";
import ClaimPage from "@/pages/ClaimPage";
import Transactions from "@/pages/Transactions";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

// Create a wallet manager instance with Pera and Defly wallets
const walletManager = new WalletManager({
  wallets: [
    { id: 'pera' as any, options: {}, metadata: { name: 'Pera Wallet' } }, 
    { id: 'defly' as any, options: {}, metadata: { name: 'Defly Wallet' } }
  ]
});

function Router() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <Switch>
        <Route path="/" component={SendFlow} />
        <Route path="/send" component={SendFlow} />
        <Route path="/claim/:token" component={ClaimPage} />
        <Route path="/transactions" component={Transactions} />
        <Route path="/connect" component={SendFlow} />
        <Route component={NotFound} />
      </Switch>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <WalletProvider manager={walletManager}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light">
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WalletProvider>
  );
}

export default App;
