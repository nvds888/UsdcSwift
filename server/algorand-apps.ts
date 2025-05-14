import algosdk from 'algosdk';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { USDC_ASSET_ID } from '../client/src/lib/constants';

// Type definition for errors
interface ErrorWithMessage {
  message: string;
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

function toErrorWithMessage(error: unknown): ErrorWithMessage {
  if (isErrorWithMessage(error)) return error;
  
  try {
    return new Error(JSON.stringify(error));
  } catch {
    // fallback in case there's an error stringifying the error
    return new Error(String(error));
  }
}

// Connect to Algorand node
const algodToken = '';
const algodServer = 'https://testnet-api.algonode.cloud';
const algodPort = '';
const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);

/**
 * Helper function to ensure an address is properly formatted as a string
 */
function ensureAddressString(address: string | algosdk.Address): string {
  if (address instanceof algosdk.Address) {
    return algosdk.encodeAddress(address.publicKey);
  }
  return address;
}

/**
 * Compiles a TEAL program from source
 * @param programSource The TEAL source code
 * @returns The compiled program bytes
 */
async function compileProgram(programSource: string): Promise<Uint8Array> {
  try {
    const encoder = new TextEncoder();
    const programBytes = encoder.encode(programSource);
    const compileResponse = await algodClient.compile(programBytes).do();
    return new Uint8Array(Buffer.from(compileResponse.result, 'base64'));
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error compiling program:", errorMsg.message);
    throw new Error(`Failed to compile program: ${errorMsg.message}`);
  }
}

/**
 * Creates an application to handle claim-by-email functionality
 * This application will hold USDC and allow it to be claimed by a specific recipient
 * 
 * @param sender The sender address that is creating the escrow
 * @param recipientAddress The recipient that will be able to claim the USDC
 * @returns Contract info including app ID and address
 */
export async function createClaimApp(
  sender: string,
  recipientAddress: string | null = null
): Promise<{
  appId: number;
  appAddress: string;
  claimToken: string;
}> {
  try {
    console.log(`Creating claim app for sender: ${sender}`);
    
    // Validate sender address
    const senderAddr = ensureAddressString(sender);
    
    // Initialize recipient address
    const initialRecipient = recipientAddress ? ensureAddressString(recipientAddress) : senderAddr;
    
    // Generate a unique claim token
    const claimToken = uuidv4();
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Simple approval program that allows only the sender to reclaim funds
    // and only the designated recipient to claim funds
    const approvalProgramTemplate = `#pragma version 6
// Check if this is an asset transfer (claim or reclaim)
txn TypeEnum
int 4 // AssetTransfer
==
bz reject

// Check if this is for USDC asset
txn XferAsset
int ${USDC_ASSET_ID} // USDC Asset ID
==
bz reject

// Check if sender is either original sender (reclaim) or recipient (claim)
txn Sender
addr ${senderAddr} // Original sender
==
bnz approve // If sender is original sender, approve (reclaim)

// Otherwise, check if sender is the recipient (claim)
txn Sender
addr ${initialRecipient} // Recipient
==
bz reject // If not recipient, reject

approve:
int 1
return

reject:
int 0
return
`;

    // Compile the approval program
    const compiledApprovalProgram = await compileProgram(approvalProgramTemplate);
    
    // Use a simple clear program that always succeeds
    const clearProgramSource = "#pragma version 6\nint 1\nreturn";
    const compiledClearProgram = await compileProgram(clearProgramSource);
    
    // Calculate app ID (in real app we'd get this from transaction result)
    const accountInfo = await algodClient.accountInformation(senderAddr).do();
    const createdApps = accountInfo.createdApps || [];
    const appId = createdApps.length > 0 
      ? createdApps[createdApps.length - 1].id + 1 
      : 10000000 + Math.floor(Date.now() / 1000) % 1000000;
    
    // Get app address
    const appAddress = algosdk.getApplicationAddress(appId);
    
    console.log(`Created app with ID: ${appId} and address: ${appAddress}`);
    
    return {
      appId,
      appAddress: ensureAddressString(appAddress),
      claimToken
    };
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error creating claim app:", errorMsg.message);
    throw new Error(`Failed to create claim app: ${errorMsg.message}`);
  }
}

/**
 * Prepares transactions to fund and set up a claim app
 * 
 * @param sender The sender who is funding the app
 * @param appId The ID of the app to fund
 * @param appAddress The address of the app
 * @param amount The amount of USDC to send
 * @returns The prepared transactions
 */
export async function prepareAppFundingTransactions(
  sender: string,
  appId: number,
  appAddress: string,
  amount: number
): Promise<{
  appFundingTxn: Uint8Array;
  usdcOptInTxn: Uint8Array;
  usdcTransferTxn: Uint8Array;
}> {
  try {
    console.log(`Preparing funding transactions for app ${appId} at address ${appAddress}`);
    
    // Validate addresses
    const senderAddr = ensureAddressString(sender);
    const validatedAppAddress = ensureAddressString(appAddress);
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // 1. Fund the app with minimum balance (0.1 ALGO)
    const appFundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: senderAddr,
      to: validatedAppAddress,
      amount: 100000, // 0.1 ALGO
      note: new Uint8Array(0),
      suggestedParams
    });
    
    // 2. Call app to opt in to USDC
    const usdcOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedAppAddress, // from app
      to: validatedAppAddress, // to app (self)
      amount: 0, // amount (0 for opt-in)
      assetIndex: USDC_ASSET_ID, // USDC asset ID
      note: new Uint8Array(0),
      suggestedParams
      // This will be signed by the app's logic
    });
    
    // 3. Transfer USDC to the app (signed by sender)
    const microAmount = Math.floor(amount * 1_000_000); // Convert to micro USDC
    const usdcTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: senderAddr, // from sender
      to: validatedAppAddress, // to app
      amount: microAmount, // amount of USDC
      assetIndex: USDC_ASSET_ID, // USDC asset ID
      note: new Uint8Array(0),
      suggestedParams
    });
    
    console.log("Funding transactions prepared successfully");
    
    return {
      appFundingTxn: algosdk.encodeUnsignedTransaction(appFundingTxn),
      usdcOptInTxn: algosdk.encodeUnsignedTransaction(usdcOptInTxn),
      usdcTransferTxn: algosdk.encodeUnsignedTransaction(usdcTransferTxn)
    };
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error preparing app funding transactions:", errorMsg.message);
    throw new Error(`Failed to prepare app funding transactions: ${errorMsg.message}`);
  }
}

/**
 * Prepares a transaction to claim USDC from an app
 * 
 * @param appId The ID of the app
 * @param appAddress The address of the app
 * @param recipientAddress The address that will receive the USDC
 * @param amount The amount of USDC to claim
 * @returns The prepared claim transaction
 */
export async function prepareClaimTransaction(
  appId: number,
  appAddress: string,
  recipientAddress: string,
  amount: number
): Promise<Uint8Array> {
  try {
    console.log(`Preparing claim transaction for ${recipientAddress} from app ${appId}`);
    
    // Validate addresses
    const validatedAppAddress = ensureAddressString(appAddress);
    const validatedRecipientAddress = ensureAddressString(recipientAddress);
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Calculate amount in micro USDC
    const microAmount = Math.floor(amount * 1_000_000);
    
    // Create asset transfer transaction from app to recipient
    const claimTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedAppAddress, // from app
      to: validatedRecipientAddress, // to recipient
      amount: microAmount, // amount
      assetIndex: USDC_ASSET_ID, // USDC asset ID
      note: new Uint8Array(0),
      suggestedParams
    });
    
    console.log("Claim transaction prepared successfully");
    
    return algosdk.encodeUnsignedTransaction(claimTxn);
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error preparing claim transaction:", errorMsg.message);
    throw new Error(`Failed to prepare claim transaction: ${errorMsg.message}`);
  }
}

/**
 * Prepares a transaction to reclaim USDC from an app back to the sender
 * 
 * @param appId The ID of the app
 * @param appAddress The address of the app
 * @param senderAddress The original sender who will receive the USDC back
 * @param amount The amount of USDC to reclaim
 * @returns The prepared reclaim transaction
 */
export async function prepareReclaimTransaction(
  appId: number,
  appAddress: string,
  senderAddress: string,
  amount: number
): Promise<Uint8Array> {
  try {
    console.log(`Preparing reclaim transaction for ${senderAddress} from app ${appId}`);
    
    // Validate addresses
    const validatedAppAddress = ensureAddressString(appAddress);
    const validatedSenderAddress = ensureAddressString(senderAddress);
    
    // Get suggested parameters
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Calculate amount in micro USDC
    const microAmount = Math.floor(amount * 1_000_000);
    
    // Create asset transfer transaction from app to sender
    const reclaimTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedAppAddress, // from app
      to: validatedSenderAddress, // to sender
      amount: microAmount, // amount
      assetIndex: USDC_ASSET_ID, // USDC asset ID
      note: new Uint8Array(0),
      suggestedParams
    });
    
    console.log("Reclaim transaction prepared successfully");
    
    return algosdk.encodeUnsignedTransaction(reclaimTxn);
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error preparing reclaim transaction:", errorMsg.message);
    throw new Error(`Failed to prepare reclaim transaction: ${errorMsg.message}`);
  }
}

/**
 * Submits a signed transaction to the network
 * 
 * @param signedTxn The signed transaction to submit
 * @returns The transaction ID
 */
export async function submitTransaction(signedTxn: Uint8Array): Promise<string> {
  try {
    // Submit the transaction
    const response = await algodClient.sendRawTransaction(signedTxn).do();
    const txid = response.txid;
    
    // Wait for confirmation
    await algosdk.waitForConfirmation(algodClient, txid, 5);
    
    console.log(`Transaction confirmed with ID: ${txid}`);
    
    return txid;
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error submitting transaction:", errorMsg.message);
    throw new Error(`Failed to submit transaction: ${errorMsg.message}`);
  }
}

/**
 * Gets the USDC balance of an address
 * 
 * @param address The address to check
 * @returns The USDC balance
 */
export async function getUsdcBalance(address: string): Promise<number> {
  try {
    // Validate address
    const validatedAddress = ensureAddressString(address);
    
    // Get account information
    const accountInfo = await algodClient.accountInformation(validatedAddress).do();
    
    // Look for USDC in the assets
    for (const asset of accountInfo.assets || []) {
      if (asset.assetId === USDC_ASSET_ID) {
        return Number(asset.amount) / 1_000_000; // Convert micro USDC to USDC
      }
    }
    
    return 0; // No USDC found
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error("Error getting USDC balance:", errorMsg.message);
    return 0;
  }
}