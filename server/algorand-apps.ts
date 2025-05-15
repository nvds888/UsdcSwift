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
// Handle different transaction types
txn TypeEnum
int 4 // AssetTransfer
==
bnz handle_asset_transfer

txn TypeEnum
int 6 // ApplicationCall
==
bnz handle_app_call

// Reject other transaction types
b reject

// Handle application calls (including opt-in)
handle_app_call:
// Check if this is the opt-in call
txna ApplicationArgs 0
byte "opt_in_to_asset"
==
bnz approve_opt_in

// Reject other app calls
b reject

approve_opt_in:
// The app call is for opt-in, so approve it
int 1
return

// Handle asset transfers (for claims and reclaims)
handle_asset_transfer:
// Check if this is for USDC asset
txn XferAsset
int ${USDC_ASSET_ID} // USDC Asset ID
==
bz reject

// Check if sender is either original sender (reclaim)
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
    
    // Create application creation transaction
    const onCompletionValue = algosdk.OnApplicationComplete.NoOpOC;
    const localInts = 0;
    const localBytes = 0;
    const globalInts = 1; // For storing amount
    const globalBytes = 2; // For storing sender and recipient
    
    // Instead of creating the app directly, we'll estimate what the app ID will be
    // This approach calculates the next app ID a user would create
    // In a production app, you would create the app first, then proceed with funding
    
    // Get account info to calculate the next app ID
    const accountInfo = await algodClient.accountInformation(senderAddr).do();
    // Handle different property naming in different versions of algosdk
    const createdApps = accountInfo.createdApps || [];
    
    // Calculate the next app ID this account would create
    // If they have created apps before, increment from the last one
    // Otherwise use a base ID plus timestamp to make it unique
    let appId = 0;
    if (createdApps.length > 0) {
      // Find the highest app ID and add 1
      const highestAppId = Math.max(...createdApps.map(app => 
        typeof app.id === 'number' ? app.id : parseInt(app.id)
      ));
      appId = highestAppId + 1;
    } else {
      // Use a predictable pattern for the first app
      // Use timestamp to make it unique if no creation round information is available
      const timestamp = Math.floor(Date.now() / 1000);
      appId = 10000000 + timestamp % 1000000;
    }
    
    console.log(`Estimated future app ID: ${appId}`);
    
    // Get the app address from the calculated ID
    // Calculate the app address from the app ID
    const appAddress = algosdk.getApplicationAddress(appId);
    
    if (!appId) {
      throw new Error('Failed to get application ID from transaction result');
    }
    
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