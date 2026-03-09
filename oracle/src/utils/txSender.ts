import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { getChain } from "../config/chains.js";
import { getWalletClient } from "./signing.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS = 3;
const GAS_BUMP_NUMERATOR = 110n;
const GAS_BUMP_DENOMINATOR = 100n;

let localNonce: number | null = null;
let mutex: Promise<unknown> = Promise.resolve();

function isNonceOrUnderpricedError(err: unknown): boolean {
  const msg = (err as Error).message || "";
  return (
    msg.includes("nonce too low") ||
    msg.includes("nonce too high") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  );
}

/**
 * Centralized tx sender with local nonce management and gas bumping.
 * All keepers must use this instead of walletClient.writeContract() directly.
 *
 * Serializes all tx submissions via a mutex queue so only one is in-flight
 * at a time, eliminating nonce collisions between concurrent keepers.
 *
 * On nonce/underpriced errors, re-syncs nonce from chain and retries with
 * 10% gas bump per attempt (up to 3 attempts).
 */
export async function sendTx(request: Parameters<ReturnType<typeof getWalletClient>["writeContract"]>[0]): Promise<Hex> {
  return enqueue(async () => {
    const walletClient = getWalletClient();
    const publicClient = createPublicClient({
      chain: getChain(),
      transport: http(config.rpcUrl),
    });

    if (localNonce === null) {
      localNonce = await publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: 'pending',
      });
      logger.info("TxSender", `Initialized nonce: ${localNonce}`);
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const baseGasPrice = await publicClient.getGasPrice();
      // Start at 1.2x base, then +10% per retry: attempt 0 = 120%, attempt 1 = 132%, attempt 2 = 145%
      let bumpedGas = (baseGasPrice * 120n) / 100n;
      for (let i = 0; i < attempt; i++) {
        bumpedGas = (bumpedGas * GAS_BUMP_NUMERATOR) / GAS_BUMP_DENOMINATOR;
      }

      try {
        const hash = await walletClient.writeContract({
          ...request,
          nonce: localNonce,
          gasPrice: bumpedGas,
        } as typeof request);
        logger.debug("TxSender", `Tx sent nonce=${localNonce} gas=${bumpedGas} hash=${hash}`);
        localNonce++;
        return hash;
      } catch (err) {
        if (isNonceOrUnderpricedError(err) && attempt < MAX_ATTEMPTS - 1) {
          const oldNonce = localNonce;
          localNonce = await publicClient.getTransactionCount({
            address: walletClient.account.address,
            blockTag: 'pending',
          });
          logger.warn(
            "TxSender",
            `Nonce error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), re-synced ${oldNonce}→${localNonce}: ${(err as Error).message.slice(0, 120)}`
          );
          continue;
        }
        throw err;
      }
    }

    throw new Error("TxSender: exhausted all retry attempts");
  });
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = mutex.then(fn, fn);
  mutex = result.catch(() => {});
  return result;
}
