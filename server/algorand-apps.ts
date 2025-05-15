import algosdk from 'algosdk';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { USDC_ASSET_ID } from '../client/src/lib/constants';
import * as algokit from '@algorandfoundation/algokit-utils';

// Type definition for errors
interface ErrorWithMessage {
  message: string;
}

function createApprovalProgram(senderAddress: string): string {
  return `#pragma version 8
// Global state keys
byte "sender"
byte "recipient"
byte "amount"

// Check if creating application
txn ApplicationID
int 0
==
bnz creation

// Check transaction type
txn TypeEnum
int 4 // AssetTransfer
==
bnz handle_transfer

txn TypeEnum
int 6 // ApplicationCall
==
bnz handle_app_call

// Reject other types
int 0
return

creation:
// Store sender address
byte "sender"
addr ${senderAddress}
app_global_put

// Initialize recipient as zero address
byte "recipient"
global ZeroAddress
app_global_put

int 1
return

handle_app_call:
// Check for opt-in to asset
txn ApplicationArgs 0
byte "opt_in_to_asset"
==
bnz handle_opt_in

int 0
return

handle_opt_in:
// Allow opt-in
int 1
return

handle_transfer:
// Allow transfers from app (opt-in) or from sender (funding)
txn Sender
global CurrentApplicationAddress
==
bnz allow

txn Sender
addr ${senderAddress}
==
bnz allow

int 0
return

allow:
int 1
return
`;
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
export const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);

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
export async function compileProgram(programSource: string): Promise<Uint8Array> {
  try {
    // algosdk.compile expects a string, not bytes
    const compileResponse = await algodClient.compile(programSource).do();
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
    
    // Generate a unique claim token
    const claimToken = uuidv4();
    
    // Create TEAL programs
    const approvalProgram = `#pragma version 8
// Handle application calls
txn ApplicationID
int 0
==
bnz creation

// Handle opt-in call
txn OnCompletion
int 1 // OptIn
==
bnz handle_optin

// Handle normal calls
txn ApplicationArgs 0
byte "opt_in_to_asset"
==
bnz allow_opt_in

// Check if this is an asset transfer
txn TypeEnum
int 4 // AssetTransfer
==
bnz check_transfer

// Reject other calls
int 0
return

creation:
int 1
return

handle_optin:
int 1
return

allow_opt_in:
int 1
return

check_transfer:
// Only allow transfers from the app or to the recipient
txn Sender
global CurrentApplicationAddress
==
bnz allow_transfer

// Check if sender is the original creator (for reclaim)
txn Sender
txn CreatorAddress
==
bnz allow_transfer

int 0
return

allow_transfer:
int 1
return
`;

    const clearProgram = `#pragma version 8
int 1
return
`;

    // Compile programs
    const compiledApproval = await compileProgram(approvalProgram);
    const compiledClear = await compileProgram(clearProgram);
    
    // Get suggested params
    const suggestedParams = await algodClient.getTransactionParams().do();
    
    // Create the application using proper algosdk methods
    const createTxn = algosdk.makeApplicationCreateTxnFromObject({
      from: sender, // Note: it's 'from' not 'sender' in older algosdk versions
      approvalProgram: compiledApproval,
      clearProgram: compiledClear,
      numLocalInts: 0,
      numLocalByteSlices: 0,
      numGlobalInts: 1,
      numGlobalByteSlices: 2,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams
    });
    
    // This transaction needs to be signed by the user's wallet
    // Return the unsigned transaction for the frontend to sign
    const encodedTxn = algosdk.encodeUnsignedTransaction(createTxn);
    
    // Return the transaction data
    // The actual app ID will be determined after the transaction is submitted
    return {
      appId: 0, // Will be updated after submission
      appAddress: '', // Will be calculated after we get the app ID
      claimToken,
      createTxn: encodedTxn
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
    
    // 1. Fund the app with more balance (0.2 ALGO) to ensure it has enough for opt-in
    const appFundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddr,
      receiver: validatedAppAddress,
      amount: 200000, // 0.2 ALGO for minimum balance + operations
      note: new Uint8Array(0),
      suggestedParams
    });
    
    // Let's give the funding transaction time to be confirmed before executing other transactions
    // by not putting them in the same group
    
    // Create app call transaction to opt in to USDC
    // We need to call the app first to authorize the opt-in
    const usdcOptInTxn = algosdk.makeApplicationNoOpTxnFromObject({
      appIndex: appId,
      suggestedParams,
      sender: senderAddr,
      appArgs: [new Uint8Array(Buffer.from("opt_in_to_asset"))],
      foreignAssets: [USDC_ASSET_ID]
    });
    
    // 3. Transfer USDC to the app (after opt-in succeeded)
    // Use a separate suggestedParams to ensure this happens after opt-in
    const transferParams = {...suggestedParams};
    transferParams.flatFee = true;
    transferParams.fee = BigInt(1000); // Standard fee as BigInt for v3.2.0
    
    const microAmount = Math.floor(amount * 1_000_000); // Convert to micro USDC
    const usdcTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: senderAddr, // from sender
      receiver: validatedAppAddress, // to app
      amount: microAmount, // amount of USDC
      assetIndex: USDC_ASSET_ID, // USDC asset ID
      note: new Uint8Array(0),
      suggestedParams: transferParams
    });
    
    // Group funding and opt-in transactions together
    const fundAndOptInTxns = [appFundingTxn, usdcOptInTxn];
    algosdk.assignGroupID(fundAndOptInTxns);
    
    // Keep transfer as a separate txn
    // This ensures the right execution order: fund & opt-in first, then transfer
    
    console.log("Transactions prepared successfully");
    
    return {
      appFundingTxn: algosdk.encodeUnsignedTransaction(fundAndOptInTxns[0]),
      usdcOptInTxn: algosdk.encodeUnsignedTransaction(fundAndOptInTxns[1]),
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
      sender: validatedAppAddress, // from app
      receiver: validatedRecipientAddress, // to recipient
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
      sender: validatedAppAddress, // from app
      receiver: validatedSenderAddress, // to sender
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
    console.log("Submitting transaction to Algorand network...");
    // Submit the transaction - adjusted for algosdk v3.2.0
    const response = await algodClient.sendRawTransaction(signedTxn).do();
    
    // Extract txId - format changed in algosdk v3.2.0
    const txid = response.txId || response.txid || Object.values(response)[0];
    
    console.log(`Transaction submitted with ID: ${txid}`);
    
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
      if (Number(asset.assetId) === USDC_ASSET_ID) {
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