import algosdk from 'algosdk';
import { USDC_ASSET_ID } from '../client/src/lib/constants';

// Algorand network connection (default to testnet for now)
const NETWORK = 'testnet';
const algodServer = NETWORK === 'mainnet'
  ? 'https://mainnet-api.algonode.cloud'
  : 'https://testnet-api.algonode.cloud';
const algodToken = '';
const algodPort = '';
const algodClient = new algosdk.Algodv2(algodToken, algodServer, algodPort);

interface ErrorWithMessage {
  message: string;
}

function toErrorWithMessage(error: unknown): ErrorWithMessage {
  if (isErrorWithMessage(error)) return error;
  try {
    return new Error(String(error));
  } catch {
    return new Error('Unknown error');
  }
}

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Helper function to ensure an address is properly formatted as a string
 */
function ensureAddressString(address: string | algosdk.Address): string {
  if (typeof address === 'string') {
    return address;
  }
  return address.toString();
}

/**
 * Prepares a logic signature for an app call to opt-in to USDC
 * 
 * @param appId The ID of the app
 * @returns A logic signature that can sign the opt-in transaction
 */
export async function prepareAppCallForOptIn(appId: number): Promise<algosdk.LogicSigAccount> {
  try {
    // Get app information
    const appInfo = await algodClient.getApplicationByID(appId).do();
    if (!appInfo) {
      throw new Error(`App ${appId} not found`);
    }
    
    // Get program bytes from the app's approval program
    const programBytes = appInfo.params["approval-program"];
    if (!programBytes) {
      throw new Error(`App ${appId} has no approval program`);
    }
    
    // Create a logic signature for the app
    const lsig = new algosdk.LogicSigAccount(Buffer.from(programBytes, 'base64'));
    console.log(`Created logic signature for app ${appId}`);
    
    return lsig;
  } catch (error) {
    const errorMsg = toErrorWithMessage(error);
    console.error(`Error preparing app call for opt-in: ${errorMsg.message}`);
    throw new Error(`Failed to prepare app call for opt-in: ${errorMsg.message}`);
  }
}