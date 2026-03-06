"use client";

import { useReadContracts } from "wagmi";
import { formatEther, type Address } from "viem";
import { FEEDS, CUSTODY_ADDRESSES, CUSTODY_ABI } from "../../lib/contracts";

export function CustodyLiquidity() {
  const custodyEntries = FEEDS.map((f) => ({
    feed: f,
    address: CUSTODY_ADDRESSES[f.id] as Address | undefined,
  })).filter((e) => e.address);

  const { data } = useReadContracts({
    contracts: custodyEntries.flatMap((e) => [
      {
        address: e.address!,
        abi: CUSTODY_ABI,
        functionName: "availableBalance" as const,
      },
      {
        address: e.address!,
        abi: CUSTODY_ABI,
        functionName: "reservedBalance" as const,
      },
    ]),
    query: { refetchInterval: 10000 },
  });

  if (custodyEntries.length === 0) return null;

  return (
    <div className="flex gap-3 px-4 py-2 overflow-x-auto">
      {custodyEntries.map((entry, i) => {
        const available = data?.[i * 2]?.result as bigint | undefined;
        const reserved = data?.[i * 2 + 1]?.result as bigint | undefined;
        const total = available ? Number(formatEther(available)) : 0;
        const res = reserved ? Number(formatEther(reserved)) : 0;
        const unreserved = total - res;

        return (
          <div
            key={entry.feed.id}
            className="bg-gray-900 rounded-lg px-3 py-2 text-sm flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-gray-400">{entry.feed.name}</span>
            <span className="text-white font-mono">
              $
              {unreserved > 0
                ? unreserved.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })
                : "0"}
            </span>
            {res > 0 && (
              <span className="text-gray-500 text-xs font-mono">
                ({res.toLocaleString(undefined, { maximumFractionDigits: 0 })} reserved)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
