import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { WalletProvider, WalletManager, WalletId, NetworkId } from "@txnlab/use-wallet-react";
import NotFound from "@/pages/not-found";
import SendFlow from "@/pages/SendFlow";
import SendFlowNew from "@/pages/SendFlowNew";
import ClaimPage from "@/pages/ClaimPage";
import Transactions from "@/pages/Transactions";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

// Create a wallet manager instance with Pera and Defly wallets
const walletManager = new WalletManager({
  wallets: [
    { id: WalletId.PERA, options: {}, metadata: { name: 'Pera Wallet', icon: 'P' } }, 
    { id: WalletId.DEFLY, options: {}, metadata: { name: 'Defly Wallet', icon: 'D' } }
  ],
  defaultNetwork: NetworkId.TESTNET
});

function Router() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <Switch>
        <Route path="/" component={SendFlowNew} />
        <Route path="/send" component={SendFlowNew} />
        <Route path="/send-old" component={SendFlow} />
        <Route path="/claim/:token" component={ClaimPage} />
        <Route path="/transactions" component={Transactions} />
        <Route path="/connect" component={SendFlowNew} />
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
