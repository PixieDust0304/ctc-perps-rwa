import { createWalletClient, http, encodeAbiParameters, parseAbiParameters, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "../config/chains.js";
import { config } from "../config/index.js";

export function getSignerAccount() {
  if (!config.signerPrivateKey) throw new Error("SIGNER_PRIVATE_KEY not set");
  return privateKeyToAccount(config.signerPrivateKey as Hex);
}

export function getWalletClient() {
  const account = getSignerAccount();
  return createWalletClient({
    account,
    chain: getChain(),
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

  // Replicate the Solidity: keccak256(abi.encode(feedIds, prices, timestamps, freshFlags))
  const encoded = encodeAbiParameters(
    parseAbiParameters("uint16[], uint256[], uint256[], bool[]"),
    [
      feedIds.map((id) => id as unknown as number),
      prices,
      timestamps,
      freshFlags,
    ]
  );
  const messageHash = keccak256(encoded);

  const signature = await account.signMessage({ message: { raw: messageHash as Hex } });
  return signature;
}
