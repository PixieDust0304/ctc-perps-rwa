import { createPublicClient, http, type Hex } from "viem";
import { config } from "../config/index.js";
import { creditcoinLocal } from "../config/chains.js";
import { CustodyABI } from "../abi/index.js";
import { getWalletClient } from "../utils/signing.js";
import { logger } from "../utils/logger.js";

const FEE_INTERVAL_MS = config.feeInterval * 1000; // 15s default
let lastAccrualTime = 0;

/**
 * Called every tick — only fires accrueFees() if ≥15s have elapsed
 */
export async function maybeTriggerAccrual(): Promise<void> {
  const now = Date.now();
  if (now - lastAccrualTime < FEE_INTERVAL_MS) return;

  const custodyAddresses = config.custodyAddresses;
  const entries = Object.entries(custodyAddresses);
  if (entries.length === 0) return;

  lastAccrualTime = now;

  const walletClient = getWalletClient();
  const publicClient = createPublicClient({
    chain: creditcoinLocal,
    transport: http(config.rpcUrl),
  });

  const results = await Promise.allSettled(
    entries.map(async ([feedId, address]) => {
      const addr = address as Hex;
      try {
        const { request } = await publicClient.simulateContract({
          address: addr,
          abi: CustodyABI,
          functionName: "accrueFees",
          account: walletClient.account,
        });
        const txHash = await walletClient.writeContract(request);
        logger.debug("FeeAccrual", `accrueFees() for feed ${feedId}, tx: ${txHash}`);
      } catch (err) {
        // accrueFees may revert if called too early — that's fine
        logger.debug("FeeAccrual", `accrueFees() skipped for feed ${feedId}: ${(err as Error).message}`);
      }
    })
  );
}
