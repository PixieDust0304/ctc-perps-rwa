import { createWalletClient, http, encodePacked, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { creditcoinLocal } from "../config/chains.js";
import { config } from "../config/index.js";

export function getSignerAccount() {
  if (!config.signerPrivateKey) throw new Error("SIGNER_PRIVATE_KEY not set");
  return privateKeyToAccount(config.signerPrivateKey as Hex);
}

export function getWalletClient() {
  const account = getSignerAccount();
  return createWalletClient({
    account,
    chain: creditcoinLocal,
    transport: http(config.rpcUrl),
  });
}

/**
 * Sign a price update batch for the Oracle contract
 */
export async function signPriceBatch(
  feedIds: number[],
  prices: bigint[],
  timestamps: bigint[],
  freshFlags: boolean[]
): Promise<Hex> {
  const account = getSignerAccount();

  // Replicate the Solidity: keccak256(abi.encodePacked(feedIds, prices, timestamps, freshFlags))
  const types: string[] = [];
  const values: (number | bigint | boolean)[] = [];

  for (const id of feedIds) {
    types.push("uint16");
    values.push(id);
  }
  for (const p of prices) {
    types.push("uint256");
    values.push(p);
  }
  for (const t of timestamps) {
    types.push("uint256");
    values.push(t);
  }
  for (const f of freshFlags) {
    types.push("bool");
    values.push(f);
  }

  const encoded = encodePacked(
    types as readonly string[],
    values as readonly (number | bigint | boolean)[]
  );
  const messageHash = keccak256(encoded);

  const signature = await account.signMessage({ message: { raw: messageHash as Hex } });
  return signature;
}
