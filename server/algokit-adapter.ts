/**
 * Algorand Transaction Adapter
 * Simplified version using direct algosdk calls
 */

import algosdk from 'algosdk';
import crypto from 'crypto';

// Algorand node connection details
const ALGOD_TOKEN = '';
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = '';

// USDC asset ID on testnet
const USDC_ASSET_ID = 10458941;

// Initialize Algorand client
const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

/**
 * Creates a TEAL program for an escrow account
 */
export function createEscrowTEAL(sender: string, receiver: string, hash: string): string {
  const tealSource = `#pragma version 6
// Check if transaction group size is valid
global GroupSize
int 1
==
bnz valid_group_size

// Transaction group validation failed
err

// Valid group size, continue with transaction validation
valid_group_size:
// Get the transaction type
txn TypeEnum
int 4 // AssetTransfer transaction
==
// Ensure it's an Asset Transfer
bz unauthorized

// Check if this is a claim (receiver is sending) or reclaim (sender is sending)
// Allow the intended receiver to claim
txn Sender
addr ${receiver}
==
bnz auth_recevier

// Allow original sender to reclaim
txn Sender
addr ${sender}
==
txn Note
byte base64 ${Buffer.from(hash).toString('base64')}
==
&&
bnz auth_sender

// Neither authorized sender nor receiver
unauthorized:
err

// Receiver is authorized
auth_recevier:
int 1
return

// Sender is authorized
auth_sender:
int 1
return`;

  return tealSource;
}

/**
 * Creates an escrow account for USDC claim mechanism
 */
export async function createEscrowAccount(sender: string): Promise<{
  escrowAddress: string;
  claimToken: string;
  logicSignature: algosdk.LogicSigAccount;
}> {
  try {
    // Generate random token for claim
    const claimToken = crypto.randomUUID();
    
    // Create TEAL program - using zero address as placeholder for receiver (will be set during claim)
    const zeroAddress = algosdk.encodeAddress(new Uint8Array(32));
    const tealSource = createEscrowTEAL(sender, zeroAddress, claimToken);
    
    // Compile TEAL to bytecode
    const compiledResult = await algodClient.compile(tealSource).do();
    const compiledBytes = new Uint8Array(Buffer.from(compiledResult.result, 'base64'));
    
    // Create logic signature from compiled program
    const logicSignature = new algosdk.LogicSigAccount(compiledBytes);
    
    // Get escrow account address
    const escrowAddress = logicSignature.address();
    
    return {
      escrowAddress,
      claimToken,
      logicSignature
    };
  } catch (error) {
    console.error('Error creating escrow account:', error);
    throw new Error(`Failed to create escrow account: ${String(error)}`);
  }
}

/**
 * Prepares a transaction to fund the escrow account with USDC
 */
export async function prepareFundEscrowTransaction(
  senderAccount: string,
  escrowAddress: string,
  amount: number
): Promise<{ txnId: string; escrowAddress: string }> {
  try {
    console.log(`Preparing fund transaction with pure algosdk: sender=${senderAccount}, escrow=${escrowAddress}, amount=${amount}`);
    
    // Convert amount to microUSDC (6 decimal places)
    const microAmount = Math.floor(amount * 1_000_000);
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Create asset transfer transaction
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: senderAccount,
      to: escrowAddress,
      amount: microAmount,
      assetIndex: USDC_ASSET_ID,
      suggestedParams,
      note: new Uint8Array(Buffer.from("USDC Email Transfer"))
    });
    
    return {
      txnId: txn.txID(),
      escrowAddress
    };
  } catch (error) {
    console.error('Error preparing fund transaction:', error);
    throw new Error(`Failed to prepare fund transaction: ${String(error)}`);
  }
}

/**
 * Submits a signed transaction to the Algorand network
 */
export async function submitSignedTransaction(signedTxn: Uint8Array): Promise<{ txId: string }> {
  try {
    // Submit the transaction
    const response = await algodClient.sendRawTransaction(signedTxn).do();
    
    // Extract transaction ID
    const txId = response.txId || response.txid;
    
    // Wait for confirmation
    await algosdk.waitForConfirmation(algodClient, txId, 5);
    
    return { txId };
  } catch (error) {
    console.error('Error submitting transaction:', error);
    throw new Error(`Failed to submit transaction: ${String(error)}`);
  }
}

/**
 * Claims USDC from an escrow account
 */
export async function claimFromEscrow(
  escrowAddress: string,
  recipientAddress: string,
  claimToken: string,
  logicSignature: algosdk.LogicSigAccount
): Promise<Uint8Array> {
  try {
    // Get account information to determine USDC balance
    const accountInfo = await algodClient.accountInformation(escrowAddress).do();
    
    // Find USDC asset in account assets
    let microAmount = 0;
    const assets = accountInfo.assets || [];
    for (const asset of assets) {
      if (asset['asset-id'] === USDC_ASSET_ID) {
        microAmount = Number(asset.amount);
        break;
      }
    }
    
    if (microAmount === 0) {
      throw new Error("No USDC found in escrow account");
    }
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Create asset transfer transaction
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: escrowAddress,
      to: recipientAddress,
      amount: microAmount,
      assetIndex: USDC_ASSET_ID,
      suggestedParams,
      note: new Uint8Array(Buffer.from("USDC Claim"))
    });
    
    // Sign transaction with logic signature
    const signedTxn = algosdk.signLogicSigTransaction(txn, logicSignature);
    
    return signedTxn.blob;
  } catch (error) {
    console.error('Error claiming from escrow:', error);
    throw new Error(`Failed to claim from escrow: ${String(error)}`);
  }
}

/**
 * Reclaims USDC from an escrow account back to the sender
 */
export async function reclaimFromEscrow(
  escrowAddress: string,
  senderAddress: string,
  claimToken: string,
  logicSignature: algosdk.LogicSigAccount
): Promise<Uint8Array> {
  try {
    // Get account information to determine USDC balance
    const accountInfo = await algodClient.accountInformation(escrowAddress).do();
    
    // Find USDC asset in account assets
    let microAmount = 0;
    const assets = accountInfo.assets || [];
    for (const asset of assets) {
      if (asset['asset-id'] === USDC_ASSET_ID) {
        microAmount = Number(asset.amount);
        break;
      }
    }
    
    if (microAmount === 0) {
      throw new Error("No USDC found in escrow account");
    }
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Create asset transfer transaction with claim token in note field
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: escrowAddress,
      to: senderAddress,
      amount: microAmount,
      assetIndex: USDC_ASSET_ID,
      suggestedParams,
      note: new Uint8Array(Buffer.from(claimToken))
    });
    
    // Sign transaction with logic signature
    const signedTxn = algosdk.signLogicSigTransaction(txn, logicSignature);
    
    return signedTxn.blob;
  } catch (error) {
    console.error('Error reclaiming from escrow:', error);
    throw new Error(`Failed to reclaim from escrow: ${String(error)}`);
  }
}

/**
 * Gets the USDC balance of an account
 */
export async function getUserBalance(address: string): Promise<number> {
  try {
    // Get account information
    const accountInfo = await algodClient.accountInformation(address).do();
    
    // Look for USDC asset in assets array
    const assets = accountInfo.assets || [];
    for (const asset of assets) {
      if (asset['asset-id'] === USDC_ASSET_ID) {
        // Convert from microUSDC to USDC
        return Number(asset.amount) / 1_000_000;
      }
    }
    
    // No USDC found
    return 0;
  } catch (error) {
    console.error('Error getting user balance:', error);
    return 0;
  }
}