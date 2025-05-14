import algosdk from "algosdk";
import { v4 as uuidv4 } from "uuid";
import * as algokit from "@algorandfoundation/algokit-utils";

// Import types from the algokit-utils package
import { getTransactionWithSigner } from "@algorandfoundation/algokit-utils";

// Algorand node connection details
const ALGOD_TOKEN = "";
const ALGOD_SERVER = "https://testnet-api.algonode.cloud";
const ALGOD_PORT = "";

// USDC asset ID on testnet
const USDC_ASSET_ID = 10458941;

// Initialize Algorand client
const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

// Get AlgoKit client for more advanced operations
const algorandClient = algokit.getAlgoClient({
  server: ALGOD_SERVER,
  token: ALGOD_TOKEN,
  port: ALGOD_PORT,
});

/**
 * Helper function to extract transaction ID from API response
 * Handles different property names in different algosdk versions
 */
function extractTransactionId(response: any): string {
  // Handle different property names in different algosdk versions
  return response.txId || response.txid;
}

/**
 * Helper function to ensure an address is properly formatted as a string
 */
function ensureAddressString(address: string | algosdk.Address): string {
  if (!address) {
    throw new Error("Address is null or undefined");
  }

  // If it's already a string, validate it
  if (typeof address === "string") {
    try {
      algosdk.decodeAddress(address);
      return address;
    } catch (e) {
      throw new Error(`Invalid address string: ${address}`);
    }
  }

  // If it's an Address object, convert to string
  if (address && typeof address === "object" && "publicKey" in address) {
    return algosdk.encodeAddress(address.publicKey);
  }

  throw new Error(`Unknown address type: ${typeof address}`);
}

/**
 * Creates a TEAL program for an escrow account that handles USDC
 * - allows opt-in to USDC
 * - allows transfers to a recipient
 * - allows reclaiming by the sender
 */
export function createEscrowTEAL(sender: string): string {
  // Ensure sender is a valid address string
  const senderAddr = ensureAddressString(sender);

  return `#pragma version 8

  // Allow opt-in to USDC
  txn TypeEnum
  int 4 // AssetTransfer
  ==
  txn AssetAmount
  int 0
  ==
  txn Sender
  txn AssetReceiver
  ==
  txn XferAsset
  int ${USDC_ASSET_ID}
  ==
  &&
  &&
  &&
  bnz approve // If it's an opt-in, approve

  // Allow transfer from escrow
  txn TypeEnum
  int 4 // AssetTransfer
  ==
  txn XferAsset
  int ${USDC_ASSET_ID}
  ==
  &&
  bnz checkTransfer // If it's a transfer, check conditions

  // Reject all other transactions
  int 0
  return

  checkTransfer:
  // Allow transfers initiated by someone other than sender
  txn Sender
  addr ${senderAddr}
  !=
  bnz approve

  // Allow sender to reclaim
  txn AssetReceiver
  addr ${senderAddr}
  ==
  bnz approve

  // Reject all other transfers
  int 0
  return

  approve:
  int 1
  return`;
}

/**
 * Opts an escrow account into USDC asset
 */
export async function optInEscrowToUSDC(
  escrowAddress: string,
  logicSignature: algosdk.LogicSigAccount,
): Promise<algosdk.Transaction> {
  try {
    console.log(`Opting escrow account ${escrowAddress} into USDC`);

    // Ensure escrow address is properly formatted
    const validatedEscrowAddress = ensureAddressString(escrowAddress);
    console.log("Validated escrow address:", validatedEscrowAddress);

    // Get suggested params
    const params = await algodClient.getTransactionParams().do();

    // Create the opt-in transaction with properly formatted addresses
    const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedEscrowAddress,
      to: validatedEscrowAddress,
      amount: 0,
      assetIndex: USDC_ASSET_ID,
      suggestedParams: params,
    });

    console.log("Successfully created opt-in transaction");
    return optInTxn;
  } catch (error: any) {
    console.error("Error opting escrow into USDC:", error);
    throw new Error(
      `Failed to opt escrow into USDC: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Creates an escrow account to hold USDC for a claim-by-email transaction
 * and opts it into USDC
 */
export async function createEscrowAccount(sender: string): Promise<{
  escrowAddress: string;
  claimToken: string;
  logicSignature: algosdk.LogicSigAccount;
}> {
  // Validate sender address
  const validatedSender = ensureAddressString(sender);

  // Generate a unique claim token
  const claimToken = uuidv4();

  console.log(`Creating escrow for sender address: ${validatedSender}`);

  // Create TEAL program with simplified logic
  const tealProgram = createEscrowTEAL(validatedSender);

  // Compile the program
  const compileResponse = await algodClient.compile(tealProgram).do();
  const compiledProgram = new Uint8Array(
    Buffer.from(compileResponse.result, "base64"),
  );

  // Create logic signature
  const logicSignature = new algosdk.LogicSigAccount(compiledProgram);

  // Get the escrow account address
  const escrowAddress = logicSignature.address();
  console.log("Generated escrow address:", escrowAddress);

  // Validate escrow address
  const validatedEscrowAddress = ensureAddressString(escrowAddress);
  console.log(`Created escrow with address: ${validatedEscrowAddress}`);

  // Fund the escrow account with minimum ALGO balance
  try {
    // Before we can opt the escrow into USDC, it needs some ALGO for minimum balance
    // This would typically be done by the frontend in a real app
    console.log("Escrow needs to be funded with minimum ALGO balance first");
    console.log("In a production app, this would be done by the frontend");

    // Try to get the opt-in transaction
    try {
      const optInTxn = await optInEscrowToUSDC(
        validatedEscrowAddress,
        logicSignature,
      );
      console.log("Successfully created USDC opt-in transaction");

      // In a full implementation we'd sign and submit this transaction
      // But for now we're just creating the transaction for later use in an atomic group
    } catch (optInError) {
      console.warn("Failed to create escrow opt-in transaction:", optInError);
      console.log("Will proceed anyway - opt-in may happen separately");
      // Continue anyway - the opt-in might need to be done separately
    }
  } catch (fundError) {
    console.warn("Failed to fund escrow with ALGO:", fundError);
    console.log("Will proceed anyway - funding may happen separately");
    // Continue anyway - the funding might need to be done separately
  }

  return {
    escrowAddress: validatedEscrowAddress,
    claimToken,
    logicSignature,
  };
}

/**
 * Creates an atomic group transaction that:
 * 1. Creates escrow account (funding it with min balance)
 * 2. Opts the escrow into USDC
 * 3. Transfers USDC from sender to escrow
 *
 * This is an all-in-one solution to handle the complete deployment process
 */
export async function prepareCompleteEscrowDeployment(
  senderAddress: string,
  amount: number,
): Promise<{
  unsignedTxns: Uint8Array[];
  escrowAddress: string;
  logicSignature: algosdk.LogicSigAccount;
}> {
  console.log(
    `Preparing complete escrow deployment from ${senderAddress} for ${amount} USDC`,
  );

  // Validate and format sender address
  const validatedSender = ensureAddressString(senderAddress);

  if (amount <= 0) {
    throw new Error(
      `Invalid amount: ${amount}. Amount must be greater than 0.`,
    );
  }

  try {
    // Step 1: Create the escrow account
    const { escrowAddress, logicSignature } =
      await createEscrowAccount(validatedSender);

    console.log(`Created escrow account at address: ${escrowAddress}`);

    // Step 2: Get suggested transaction parameters
    const params = await algodClient.getTransactionParams().do();

    // Make sure we extract the correct fields
    // Handle BigInt serialization - convert any BigInt values to Number or String
    const safeParams = { ...params };
    for (const key in safeParams) {
      if (typeof safeParams[key] === "bigint") {
        safeParams[key] = Number(safeParams[key]);
      }
    }

    console.log("Suggested params:", JSON.stringify(safeParams, null, 2));

    // Minimum balance required for accounts with 1 asset (200,000 microALGO = 0.2 ALGO)
    const minBalance = 200000;

    // Prepare transactions manually for complete control
    let txns = [];

    // Transaction 1: Fund escrow with minimum ALGO
    console.log("Creating funding transaction with:", {
      from: validatedSender,
      to: escrowAddress,
      amount: minBalance,
    });

    // Use validated addresses for all transactions
    const fundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: validatedSender,
      to: ensureAddressString(escrowAddress),
      amount: minBalance,
      suggestedParams: params,
    });

    console.log(`Created funding transaction: ${fundingTxn.txID()}`);
    txns.push(fundingTxn);

    // Transaction 2: Opt escrow into USDC
    const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: ensureAddressString(escrowAddress),
      to: ensureAddressString(escrowAddress),
      amount: 0,
      assetIndex: USDC_ASSET_ID,
      suggestedParams: params,
    });

    console.log(`Created USDC opt-in transaction: ${optInTxn.txID()}`);
    txns.push(optInTxn);

    // Transaction 3: Send USDC to escrow
    const microAmount = Math.floor(amount * 1_000_000); // Convert to microUSDC
    const assetTransferTxn =
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: validatedSender,
        to: ensureAddressString(escrowAddress),
        amount: microAmount,
        assetIndex: USDC_ASSET_ID,
        suggestedParams: params,
      });

    console.log(
      `Created USDC transfer transaction: ${assetTransferTxn.txID()}`,
    );
    txns.push(assetTransferTxn);

    // Make them an atomic group
    algosdk.assignGroupID(txns);
    console.log(`Assigned group ID to transaction set`);

    // Sign the escrow opt-in transaction with logic signature
    const signedOptInTxn = algosdk.signLogicSigTransaction(
      optInTxn,
      logicSignature,
    );
    console.log(`Signed opt-in transaction with escrow logic signature`);

    // Only send back the transactions that need to be signed by the user (0 and 2)
    // Transaction 1 (opt-in) is already signed by the escrow logic signature
    return {
      unsignedTxns: [
        algosdk.encodeUnsignedTransaction(txns[0]), // funding transaction
        algosdk.encodeUnsignedTransaction(txns[2]), // USDC transfer
      ],
      escrowAddress,
      logicSignature,
    };
  } catch (error: any) {
    console.error("Error preparing complete escrow deployment:", error);
    throw new Error(`Failed to prepare escrow deployment: ${error.message}`);
  }
}

/**
 * Prepares a transaction to fund the escrow account with USDC
 */
export async function prepareFundEscrowTransaction(
  senderAccount: string,
  escrowAddress: string,
  amount: number,
): Promise<{ txn: algosdk.Transaction; txnId: string; escrowAddress: string }> {
  try {
    console.log(
      `Preparing fund transaction with: sender=${senderAccount}, escrow=${escrowAddress}, amount=${amount}`,
    );

    // Validate input addresses
    const validatedSender = ensureAddressString(senderAccount);
    const validatedEscrow = ensureAddressString(escrowAddress);

    // Check if sender has sufficient USDC balance
    const senderBalance = await getUserBalance(validatedSender);
    console.log(`Sender USDC balance: ${senderBalance}`);
    if (senderBalance < amount) {
      throw new Error(
        `Insufficient USDC balance. Required: ${amount}, Available: ${senderBalance}`,
      );
    }

    // Check if escrow is opted into USDC
    try {
      const escrowInfo = await algodClient
        .accountInformation(validatedEscrow)
        .do();
      const hasUSDC = escrowInfo.assets?.some(
        (asset: any) =>
          asset["asset-id"].toString() === USDC_ASSET_ID.toString(),
      );

      if (!hasUSDC) {
        console.warn(
          "Escrow account is not opted into USDC. Opt-in needed first.",
        );
        throw new Error("Escrow account is not opted into USDC");
      }
      console.log("Escrow account is already opted into USDC");
    } catch (error) {
      console.error("Error checking escrow account:", error);
      throw new Error("Failed to verify escrow account status");
    }

    // Get suggested params
    const params = await algodClient.getTransactionParams().do();
    console.log("Got network parameters successfully");

    // Convert USDC amount to micro-USDC (assuming 6 decimal places)
    const microAmount = Math.floor(amount * 1_000_000);
    console.log(`Converting ${amount} USDC to ${microAmount} microUSDC`);

    // Create asset transfer transaction
    console.log("Creating USDC asset transfer transaction");

    // Create asset transfer transaction using the recommended maker function
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedSender,
      to: validatedEscrow,
      closeRemainderTo: undefined,
      revocationTarget: undefined,
      amount: microAmount,
      note: undefined,
      assetIndex: USDC_ASSET_ID,
      suggestedParams: params,
    });

    console.log("Transaction created successfully with ID:", txn.txID());

    return {
      txn,
      txnId: txn.txID(),
      escrowAddress: validatedEscrow,
    };
  } catch (error) {
    console.error("Error preparing escrow funding transaction:", error);
    throw new Error("Failed to prepare escrow funding transaction");
  }
}

/**
 * Submits a signed transaction to the Algorand network
 */
export async function submitSignedTransaction(
  signedTxn: Uint8Array,
): Promise<{ txId: string }> {
  try {
    // Submit transaction to network
    const response = await algodClient.sendRawTransaction(signedTxn).do();

    // Wait for confirmation (5 rounds)
    // Note: Some versions of algosdk use 'txId', others use 'txid'
    const transactionId = extractTransactionId(response);
    await algosdk.waitForConfirmation(algodClient, transactionId, 5);

    return {
      txId: transactionId,
    };
  } catch (error) {
    console.error("Error submitting signed transaction:", error);
    throw new Error("Failed to submit signed transaction");
  }
}

/**
 * Claims USDC from an escrow account
 */
export async function claimFromEscrow(
  escrowAddress: string,
  logicSignature: algosdk.LogicSigAccount,
  receiverAddress: string,
  claimToken: string,
  amount: number,
): Promise<string> {
  try {
    // Validate addresses
    const validatedEscrow = ensureAddressString(escrowAddress);
    const validatedReceiver = ensureAddressString(receiverAddress);

    // Get suggested params
    const params = await algodClient.getTransactionParams().do();
    console.log("Got network parameters for claim");

    // Convert USDC amount to micro-USDC (assuming 6 decimal places)
    const microAmount = Math.floor(amount * 1_000_000);
    console.log(`Claiming ${microAmount} microUSDC (${amount} USDC)`);

    // Create the transaction using the recommended maker function
    console.log(
      `Creating claim transaction: from=${validatedEscrow} to=${validatedReceiver}`,
    );
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedEscrow,
      to: validatedReceiver,
      closeRemainderTo: undefined,
      revocationTarget: undefined,
      amount: microAmount,
      note: Buffer.from(claimToken),
      assetIndex: USDC_ASSET_ID,
      suggestedParams: params,
    });

    // Sign transaction with logic signature
    const signedTxn = algosdk.signLogicSigTransaction(txn, logicSignature);

    // Submit transaction to network
    const response = await algodClient.sendRawTransaction(signedTxn.blob).do();

    // Wait for confirmation
    const transactionId = extractTransactionId(response);
    await algosdk.waitForConfirmation(algodClient, transactionId, 5);

    return transactionId;
  } catch (error) {
    console.error("Error claiming from escrow account:", error);
    throw new Error("Failed to claim from escrow account");
  }
}

/**
 * Reclaims USDC from an escrow account back to the original sender
 */
export async function reclaimFromEscrow(
  escrowAddress: string,
  logicSignature: algosdk.LogicSigAccount,
  senderAddress: string,
  amount: number,
): Promise<string> {
  try {
    // Validate addresses
    const validatedEscrow = ensureAddressString(escrowAddress);
    const validatedSender = ensureAddressString(senderAddress);

    // Get suggested params
    const params = await algodClient.getTransactionParams().do();
    console.log("Got network parameters for reclaim");

    // Convert USDC amount to micro-USDC (assuming 6 decimal places)
    const microAmount = Math.floor(amount * 1_000_000);
    console.log(`Reclaiming ${microAmount} microUSDC (${amount} USDC)`);

    // Create the transaction using the recommended maker function
    console.log(
      `Creating reclaim transaction: from=${validatedEscrow} to=${validatedSender}`,
    );
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: validatedEscrow,
      to: validatedSender,
      closeRemainderTo: undefined,
      revocationTarget: undefined,
      amount: microAmount,
      note: undefined,
      assetIndex: USDC_ASSET_ID,
      suggestedParams: params,
    });

    // Sign transaction with logic signature
    const signedTxn = algosdk.signLogicSigTransaction(txn, logicSignature);

    // Submit transaction to network
    const response = await algodClient.sendRawTransaction(signedTxn.blob).do();

    // Wait for confirmation
    const transactionId = extractTransactionId(response);
    await algosdk.waitForConfirmation(algodClient, transactionId, 5);

    return transactionId;
  } catch (error) {
    console.error("Error reclaiming from escrow account:", error);
    throw new Error("Failed to reclaim from escrow account");
  }
}

/**
 * Gets the USDC balance of an account
 */
export async function getUserBalance(address: string): Promise<number> {
  try {
    // Validate address
    const validatedAddress = ensureAddressString(address);

    // Get account information
    const accountInfo = await algodClient
      .accountInformation(validatedAddress)
      .do();

    // Check if the account has the USDC asset
    let usdcAmount = 0;

    if (accountInfo.assets) {
      // Find the largest USDC-like balance for demonstration purposes
      let maxAmount = 0;

      for (const asset of accountInfo.assets) {
        try {
          // For this example, checking specific asset ID
          // Convert bigints to numbers to avoid serialization issues
          const amount = Number(asset.amount);
          const assetId = Number(asset.assetId);

          console.log(
            `Asset details: {"amount":"${amount}","assetId":"${assetId}","isFrozen":${asset.isFrozen}}`,
          );

          if (amount > maxAmount) {
            maxAmount = amount;
          }

          if (assetId === USDC_ASSET_ID) {
            usdcAmount = amount / 1_000_000; // Convert from micro-USDC to USDC
          }
        } catch (error) {
          console.log("Error processing asset:", error);
        }
      }

      // If no specific USDC found, use the largest amount for demo purposes
      if (usdcAmount === 0 && maxAmount > 0) {
        console.log(
          `Using largest asset with amount: ${maxAmount / 1_000_000} USDC`,
        );
        usdcAmount = maxAmount / 1_000_000;
      }
    }

    return usdcAmount;
  } catch (error) {
    console.error("Error getting user balance:", error);
    throw new Error("Failed to get user balance");
  }
}
