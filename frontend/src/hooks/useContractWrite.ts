"use client";

import { useWriteContract, usePublicClient } from "wagmi";
import { useState } from "react";
import toast from "react-hot-toast";

export function useContractWrite() {
  const { writeContractAsync, isPending: isSigning } = useWriteContract();
  const publicClient = usePublicClient();
  const [isConfirming, setIsConfirming] = useState(false);

  const execute = async (
    config: Parameters<typeof writeContractAsync>[0],
    label: string
  ) => {
    const id = toast.loading(`${label}...`);
    try {
      const hash = await writeContractAsync(config);
      toast.loading("Confirming...", { id });
      setIsConfirming(true);

      // Wait for the transaction to be mined
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      setIsConfirming(false);

      if (receipt.status === "success") {
        toast.success(`${label} confirmed`, { id });
        return hash;
      } else {
        toast.error("Transaction reverted on-chain", { id });
        return undefined;
      }
    } catch (err: unknown) {
      setIsConfirming(false);
      const msg =
        err instanceof Error ? err.message : "Transaction rejected";
      const match = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      const short = match
        ? match[1].slice(0, 80)
        : msg.length > 80
          ? msg.slice(0, 80) + "..."
          : msg;
      toast.error(short, { id });
      return undefined;
    }
  };

  return { execute, isPending: isSigning || isConfirming };
}
