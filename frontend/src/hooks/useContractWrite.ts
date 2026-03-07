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
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      const isRejected =
        /user rejected|user denied|rejected the request|user cancelled/i.test(msg) ||
        (err as { code?: number })?.code === 4001;
      if (isRejected) {
        toast.error("Transaction rejected", { id });
        return undefined;
      }
      const reason = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      const revert = msg.match(/reverted with.*?:\s*(.+?)(?:\n|"|$)/);
      const short = reason?.[1]?.slice(0, 80) ?? revert?.[1]?.slice(0, 80) ?? "Transaction failed";
      toast.error(short, { id });
      return undefined;
    }
  };

  return { execute, isPending: isSigning || isConfirming };
}
