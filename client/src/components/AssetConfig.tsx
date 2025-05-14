import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Settings } from "lucide-react";

export function AssetConfig() {
  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState<string>("");
  
  useEffect(() => {
    // Load saved asset ID from local storage if available
    const savedAssetId = localStorage.getItem("usdc_asset_id");
    if (savedAssetId) {
      setAssetId(savedAssetId);
    }
  }, []);
  
  const saveAssetId = () => {
    localStorage.setItem("usdc_asset_id", assetId);
    
    // Update env var in session or reload to apply
    const event = new CustomEvent('asset-config-updated', { 
      detail: { assetId } 
    });
    window.dispatchEvent(event);
    
    setOpen(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="ml-2">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Asset Configuration</DialogTitle>
          <DialogDescription>
            Configure the USDC asset ID to match your testnet wallet.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="assetId" className="text-right">
              USDC Asset ID
            </Label>
            <Input
              id="assetId"
              placeholder="e.g. 10458941"
              className="col-span-3"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={saveAssetId}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}