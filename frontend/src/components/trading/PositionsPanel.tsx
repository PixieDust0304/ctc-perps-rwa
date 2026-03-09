"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContracts, usePublicClient } from "wagmi";
import { parseUnits, formatEther, decodeEventLog, type Address } from "viem";
import toast from "react-hot-toast";
import { CONTRACTS, TRADING_ABI, P2P_TRADING_ABI, ERC20_ABI, CUSTODY_ADDRESSES, CUSTODY_ABI, VAMM_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";
import { PnLPopup } from "./PnLPopup";
import type { PositionUpdate } from "../../hooks/useWebSocket";

const ORACLE_API = process.env.NEXT_PUBLIC_ORACLE_API_URL || "http://localhost:3001";

/** Convert a value that might be scientific notation (e.g., "9e+22") to BigInt safely */
function safeBigInt(val: string | number | bigint): bigint {
  if (typeof val === "bigint") return val;
  const s = String(val);
  // Plain integer string — fast path
  if (!s.includes("e") && !s.includes("E") && !s.includes(".")) return BigInt(s);
  // Scientific notation: parse mantissa + exponent without floating-point loss
  const match = s.match(/^([+-]?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (match) {
    const [, mant, expStr] = match;
    const exp = parseInt(expStr);
    const neg = mant.startsWith("-");
    const [whole, frac = ""] = mant.replace(/^[+-]/, "").split(".");
    const digits = whole + frac;
    const zerosNeeded = exp - frac.length;
    return BigInt((neg ? "-" : "") + digits + "0".repeat(Math.max(zerosNeeded, 0)));
  }
  // Decimal without exponent — truncate fractional part
  const dotIdx = s.indexOf(".");
  return BigInt(dotIdx >= 0 ? s.slice(0, dotIdx) : s);
}
/** Safely convert a raw 18-decimal string/number to a JS number (USD value) */
function toUsd(raw: string | number | bigint): number {
  return Number(formatEther(safeBigInt(raw)));
}

const MIN_OPEN_TIME_TRADING = 300; // seconds — must match Trading.sol
const MIN_OPEN_TIME_P2P = 10; // seconds — must match P2PTrading.sol

interface PositionData {
  positionId: `0x${string}`;
  feedId: number;
  isLong: boolean;
  collateral: string;
  sizeUsd: string;
  entryPrice: string;
  status?: string;
  realizedPnl?: string;
  type: "trading" | "p2p";
  openedAt?: string; // ISO string from DB or epoch seconds string from in-memory
}

type Tab = "trading" | "p2p" | "history";

const FEED_NAMES: Record<number, string> = {
  2056: "Gold",
  2069: "Silver",
  2003: "Crude Oil",
  2062: "Platinum",
};

export function PositionsPanel({
  prices,
  onPositionUpdate,
}: {
  prices: { id: number; price: number }[];
  onPositionUpdate: (cb: (update: PositionUpdate) => void) => () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { execute, isPending } = useContractWrite();
  const [tab, setTab] = useState<Tab>("trading");
  const [tradingPositions, setTradingPositions] = useState<PositionData[]>([]);
  const [p2pPositions, setP2PPositions] = useState<PositionData[]>([]);
  const [historyPositions, setHistoryPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [addCollateralId, setAddCollateralId] = useState<string | null>(null);
  const [addCollateralAmount, setAddCollateralAmount] = useState("");
  const [now, setNow] = useState(Date.now());

  // Tick every minute to update position ages
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [pnlPopup, setPnlPopup] = useState<{
    isOpen: boolean;
    pnlUsd: number;
    pnlPercent: number;
    collateral: number;
    sizeUsd: number;
    leverage: number;
    asset: string;
    isLong: boolean;
    entryPrice: number;
  } | null>(null);

  // Fetch custody fee state for all feeds with positions
  const feedIds = [...new Set(tradingPositions.map((p) => p.feedId))];
  const CUSTODY_READS_PER_FEED = 8;
  const custodyContracts = feedIds.flatMap((fid) => {
    const addr = CUSTODY_ADDRESSES[fid as keyof typeof CUSTODY_ADDRESSES] as Address | undefined;
    if (!addr) return [];
    return [
      { address: addr, abi: CUSTODY_ABI, functionName: "longOpenInterest" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "shortOpenInterest" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "lpLiquidity" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "maxBaseFeePerHourBps" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "maxFundingRatePerHourBps" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "cumulativeLongBaseFeePerUnit" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "cumulativeShortBaseFeePerUnit" as const },
      { address: addr, abi: CUSTODY_ABI, functionName: "cumulativeFundingPerUnit" as const },
    ];
  });
  const { data: custodyFeeData } = useReadContracts({
    contracts: custodyContracts.length > 0 ? custodyContracts : [],
    query: { refetchInterval: 5000 },
  });

  // Read on-chain position snapshots for fee calculation
  const openTradingPositions = tradingPositions.filter((p) => p.status === "open" || !p.status);
  const positionContracts = CONTRACTS.trading
    ? openTradingPositions.map((p) => ({
        address: CONTRACTS.trading as Address,
        abi: TRADING_ABI,
        functionName: "getPosition" as const,
        args: [p.positionId] as const,
      }))
    : [];
  const { data: positionOnChainData } = useReadContracts({
    contracts: positionContracts.length > 0 ? positionContracts : [],
    query: { refetchInterval: 5000 },
  });

  // Build map: positionId -> { baseFeeSnapshot, fundingSnapshot }
  const positionSnapshots = new Map<string, { baseFeeSnapshot: bigint; fundingSnapshot: bigint }>();
  if (positionOnChainData) {
    openTradingPositions.forEach((pos, idx) => {
      const result = positionOnChainData[idx]?.result as
        | { cumulativeBaseFeeSnapshot: bigint; cumulativeFundingSnapshot: bigint }
        | undefined;
      if (result) {
        positionSnapshots.set(pos.positionId, {
          baseFeeSnapshot: result.cumulativeBaseFeeSnapshot,
          fundingSnapshot: result.cumulativeFundingSnapshot,
        });
      }
    });
  }

  // Read VAMM state for feeds with P2P positions (for simulated exit PnL)
  const p2pFeedIds = [...new Set(p2pPositions.map((p) => p.feedId))];
  const vammContracts = CONTRACTS.vamm
    ? p2pFeedIds.map((fid) => ({
        address: CONTRACTS.vamm as Address,
        abi: VAMM_ABI,
        functionName: "vamms" as const,
        args: [fid] as const,
      }))
    : [];
  const { data: vammData } = useReadContracts({
    contracts: vammContracts.length > 0 ? vammContracts : [],
    query: { refetchInterval: 3000 },
  });

  // Build VAMM state per feed: { virtualBase, virtualQuote, active }
  const vammByFeed = new Map<number, { vBase: number; vQuote: number; active: boolean }>();
  if (vammData) {
    p2pFeedIds.forEach((fid, idx) => {
      const result = vammData[idx]?.result as [bigint, bigint, bigint, bigint, boolean] | undefined;
      if (result) {
        vammByFeed.set(fid, {
          vBase: Number(result[0]) / 1e18,
          vQuote: Number(result[1]) / 1e18,
          active: result[4],
        });
      }
    });
  }

  // Build fee info + accumulator state per feed
  interface FeedFeeInfo {
    baseFeeRateLong: number;
    baseFeeRateShort: number;
    fundingPerHour: number;
    longBaseFeeAccum: bigint;
    shortBaseFeeAccum: bigint;
    fundingAccum: bigint;
  }
  const feeInfoByFeed = new Map<number, FeedFeeInfo>();
  if (custodyFeeData) {
    feedIds.forEach((fid, idx) => {
      const base = idx * CUSTODY_READS_PER_FEED;
      const longOI = Number(formatEther((custodyFeeData[base]?.result as bigint) ?? 0n));
      const shortOI = Number(formatEther((custodyFeeData[base + 1]?.result as bigint) ?? 0n));
      const lpLiq = Number(formatEther((custodyFeeData[base + 2]?.result as bigint) ?? 0n));
      const maxBaseFeeBps = Number((custodyFeeData[base + 3]?.result as bigint) ?? 0n);
      const maxFundingBps = Number((custodyFeeData[base + 4]?.result as bigint) ?? 0n);
      const longBaseFeeAccum = (custodyFeeData[base + 5]?.result as bigint) ?? 0n;
      const shortBaseFeeAccum = (custodyFeeData[base + 6]?.result as bigint) ?? 0n;
      const fundingAccum = (custodyFeeData[base + 7]?.result as bigint) ?? 0n;

      const longUtil = lpLiq > 0 ? Math.min(longOI / lpLiq, 1) : 0;
      const shortUtil = lpLiq > 0 ? Math.min(shortOI / lpLiq, 1) : 0;
      const baseFeeRateLong = longUtil * (maxBaseFeeBps / 10000);
      const baseFeeRateShort = shortUtil * (maxBaseFeeBps / 10000);

      const totalOI = longOI + shortOI;
      const imbalance = totalOI > 0 ? (longOI - shortOI) / totalOI : 0;
      const fundingPerHour = imbalance * (maxFundingBps / 10000);

      feeInfoByFeed.set(fid, {
        baseFeeRateLong, baseFeeRateShort, fundingPerHour,
        longBaseFeeAccum, shortBaseFeeAccum, fundingAccum,
      });
    });
  }

  // Get fee costs for a specific position — uses real on-chain accumulators
  const PRECISION = 10n ** 18n;
  const getFeeCosts = (pos: PositionData) => {
    const info = feeInfoByFeed.get(pos.feedId);
    if (!info) return null;
    const sizeUsd = toUsd(pos.sizeUsd);
    const collateral = toUsd(pos.collateral);
    if (collateral === 0) return null;

    // Current fee rates (for "per hour" display and future projection)
    const baseFeeRate = pos.isLong ? info.baseFeeRateLong : info.baseFeeRateShort;
    const baseFeePerHour = sizeUsd * baseFeeRate;
    const fundingCostPerHour = pos.isLong
      ? info.fundingPerHour * sizeUsd
      : -info.fundingPerHour * sizeUsd;
    const totalPerHour = baseFeePerHour + Math.max(fundingCostPerHour, 0);

    // Real accrued fees from on-chain accumulators (mirrors PositionUtils.effectiveCollateral)
    let accumulatedBaseFee = 0;
    let accumulatedFunding = 0; // positive = trader pays, negative = trader receives
    const snapshot = positionSnapshots.get(pos.positionId);
    if (snapshot) {
      const sizeRaw = safeBigInt(pos.sizeUsd);

      // Base fee: (currentAccum - snapshot) * sizeUsd / PRECISION
      const baseFeeAccum = pos.isLong ? info.longBaseFeeAccum : info.shortBaseFeeAccum;
      const baseFeeRaw = (baseFeeAccum - snapshot.baseFeeSnapshot) * sizeRaw / PRECISION;
      accumulatedBaseFee = Number(formatEther(baseFeeRaw));

      // Funding: signed, longs pay when positive, shorts pay when negative
      const fundingDelta = info.fundingAccum - snapshot.fundingSnapshot;
      const signedDelta = pos.isLong ? fundingDelta : -fundingDelta;
      const fundingRaw = signedDelta * sizeRaw / PRECISION;
      accumulatedFunding = Number(formatEther(fundingRaw));
    } else if (pos.openedAt) {
      // Fallback: naive estimate when on-chain data not yet loaded
      const openedAtMs = pos.openedAt.includes("T")
        ? new Date(pos.openedAt).getTime()
        : Number(pos.openedAt) * 1000;
      const hoursOpen = (Date.now() - openedAtMs) / 3600000;
      accumulatedBaseFee = totalPerHour * Math.max(hoursOpen, 0);
    }

    // Total drain = base fees + funding paid (funding received reduces drain)
    const totalAccrued = accumulatedBaseFee + accumulatedFunding;
    const effectiveCollateral = collateral - totalAccrued;

    // Fee-liq: time until effective collateral hits maintenance margin (10%)
    const maintenanceMargin = collateral * 0.1;
    const remainingBudget = effectiveCollateral - maintenanceMargin;
    const hoursToLiq = totalPerHour > 0 ? Math.max(remainingBudget, 0) / totalPerHour : Infinity;

    return {
      baseFeePerHour,
      fundingCostPerHour: Math.max(fundingCostPerHour, 0),
      totalPerHour,
      hoursToLiq,
      accumulatedFees: Math.max(totalAccrued, 0),
      effectiveCollateral,
    };
  };

  const fetchTrading = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `${ORACLE_API}/api/positions?owner=${address}&status=open`
      );
      if (res.ok) {
        const data = await res.json();
        setTradingPositions(data.map((row: any) => mapRow(row, "trading")));
      }
    } catch { }
  }, [address]);

  const fetchP2P = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `${ORACLE_API}/api/positions/p2p?owner=${address}&status=open`
      );
      if (res.ok) {
        const data = await res.json();
        setP2PPositions(data.map((row: any) => mapRow(row, "p2p")));
      }
    } catch { }
  }, [address]);

  const fetchHistory = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(
        `${ORACLE_API}/api/positions/history?owner=${address}`
      );
      if (res.ok) {
        const data = await res.json();
        setHistoryPositions(
          data.map((row: any) => mapRow(row, row.type ?? "trading"))
        );
      }
    } catch { }
  }, [address]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchTrading(), fetchP2P(), fetchHistory()]);
    } finally {
      setLoading(false);
    }
  }, [fetchTrading, fetchP2P, fetchHistory]);

  // Fetch all on mount, tab change, and every 10s
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(fetchAll, 10_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // WebSocket updates
  useEffect(() => {
    if (!onPositionUpdate) return;

    const unsub = onPositionUpdate((update: PositionUpdate) => {
      const pos = update.position;
      const isOwner = address && (pos.owner as string)?.toLowerCase() === address.toLowerCase();

      // Oracle broadcasts positions with `id`, some events use `positionId`
      const posId = ((pos.id ?? pos.positionId) as string | undefined) as `0x${string}` | undefined;

      if (update.action === "opened" && isOwner) {
        // Add directly to local state — avoids race with async DB write
        const newPos: PositionData = {
          positionId: posId!,
          feedId: pos.feedId as number,
          isLong: pos.isLong as boolean,
          collateral: (pos.collateral as string) ?? "0",
          sizeUsd: (pos.sizeUsd as string) ?? "0",
          entryPrice: (pos.entryPrice as string) ?? "0",
          status: "open",
          type: update.positionType,
          openedAt: new Date().toISOString(),
        };
        if (update.positionType === "trading") {
          setTradingPositions((prev) =>
            prev.some((p) => p.positionId === newPos.positionId) ? prev : [...prev, newPos]
          );
        } else {
          setP2PPositions((prev) =>
            prev.some((p) => p.positionId === newPos.positionId) ? prev : [...prev, newPos]
          );
        }
      } else if (
        update.action === "closed" ||
        update.action === "liquidated"
      ) {
        setTradingPositions((prev) =>
          prev.filter((p) => p.positionId !== posId)
        );
        setP2PPositions((prev) =>
          prev.filter((p) => p.positionId !== posId)
        );
        fetchAll();
      } else if (update.action === "collateralAdded" && isOwner) {
        // Update collateral directly in local state
        const newCol = (pos.newCollateral as string) ?? (pos.collateral as string);
        if (newCol) {
          setTradingPositions((prev) =>
            prev.map((p) => p.positionId === posId ? { ...p, collateral: newCol } : p)
          );
        }
      } else if (update.action === "settled") {
        if (posId) {
          setP2PPositions((prev) =>
            prev.filter((p) => p.positionId !== posId)
          );
        }
        fetchAll();
      }
    });

    return unsub;
  }, [onPositionUpdate, address, tab, fetchAll]);

  const handleClose = async (pos: PositionData) => {
    if (!CONTRACTS.trading || !publicClient) return;

    // Pre-flight: check min open time before sending tx
    if (pos.openedAt) {
      const minTime = pos.type === "p2p" ? MIN_OPEN_TIME_P2P : MIN_OPEN_TIME_TRADING;
      const openedAtMs = pos.openedAt.includes("T")
        ? new Date(pos.openedAt).getTime() // ISO string from DB
        : Number(pos.openedAt) * 1000; // epoch seconds from in-memory
      const elapsedSec = Math.floor((Date.now() - openedAtMs) / 1000);
      const remaining = minTime - elapsedSec;
      if (remaining > 0) {
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        toast.error(`Cannot close yet — ${timeStr} remaining`);
        return;
      }
    }

    const hash = await execute(
      {
        address: CONTRACTS.trading as Address,
        abi: TRADING_ABI,
        functionName: "closePosition",
        args: [pos.positionId],
      },
      "Closing position"
    );

    if (hash) {
      // Optimistically remove from local state
      setTradingPositions((prev) => prev.filter((p) => p.positionId !== pos.positionId));

      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: TRADING_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "PositionClosed") {
              const realizedPnl = Number(formatEther((decoded.args as { realizedPnl: bigint }).realizedPnl));
              const collateral = toUsd(pos.collateral);
              const sizeUsd = toUsd(pos.sizeUsd);
              const entryPrice = toUsd(pos.entryPrice);
              const leverage = collateral > 0 ? sizeUsd / collateral : 0;
              const pnlPercent = collateral > 0 ? (realizedPnl / collateral) * 100 : 0;
              setPnlPopup({
                isOpen: true,
                pnlUsd: realizedPnl,
                pnlPercent,
                collateral,
                sizeUsd,
                leverage,
                asset: FEED_NAMES[pos.feedId] ?? `Feed ${pos.feedId}`,
                isLong: pos.isLong,
                entryPrice,
              });
              break;
            }
          } catch {
            // Not our event, skip
          }
        }
      } catch {
        // Receipt fetch failed, no popup
      }

      // Refresh all tabs to update counts + history
      fetchAll();
    }
  };

  const handleCloseP2P = async (pos: PositionData) => {
    if (!CONTRACTS.p2pTrading || !publicClient) return;

    // Pre-flight: check min open time
    if (pos.openedAt) {
      const openedAtMs = pos.openedAt.includes("T")
        ? new Date(pos.openedAt).getTime()
        : Number(pos.openedAt) * 1000;
      const elapsedSec = Math.floor((Date.now() - openedAtMs) / 1000);
      const remaining = MIN_OPEN_TIME_P2P - elapsedSec;
      if (remaining > 0) {
        toast.error(`Cannot close yet — ${remaining}s remaining`);
        return;
      }
    }

    const hash = await execute(
      {
        address: CONTRACTS.p2pTrading as Address,
        abi: P2P_TRADING_ABI,
        functionName: "closeP2PPosition",
        args: [pos.positionId],
      },
      "Closing P2P position"
    );

    if (hash) {
      // Optimistically remove from local state
      setP2PPositions((prev) => prev.filter((p) => p.positionId !== pos.positionId));

      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: P2P_TRADING_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "P2PPositionClosed") {
              const realizedPnl = Number(formatEther((decoded.args as { realizedPnl: bigint }).realizedPnl));
              const collateral = toUsd(pos.collateral);
              const entryPrice = toUsd(pos.entryPrice);
              const pnlPercent = collateral > 0 ? (realizedPnl / collateral) * 100 : 0;
              setPnlPopup({
                isOpen: true,
                pnlUsd: realizedPnl,
                pnlPercent,
                collateral,
                sizeUsd: collateral, // spot: size = collateral
                leverage: 1,
                asset: FEED_NAMES[pos.feedId] ?? `Feed ${pos.feedId}`,
                isLong: pos.isLong,
                entryPrice,
              });
              break;
            }
          } catch {
            // Not our event
          }
        }
      } catch {
        // Receipt fetch failed
      }

      // Refresh all tabs to update counts + history
      fetchAll();
    }
  };

  const handleAddCollateral = async (pos: PositionData) => {
    if (!CONTRACTS.trading || !CONTRACTS.mockUSDC || !addCollateralAmount) return;
    const amount = parseUnits(addCollateralAmount, 18);
    await execute(
      {
        address: CONTRACTS.mockUSDC as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.trading as Address, amount],
      },
      "Approving USDC"
    );
    const result = await execute(
      {
        address: CONTRACTS.trading as Address,
        abi: TRADING_ABI,
        functionName: "addCollateral",
        args: [pos.positionId, amount],
      },
      "Adding collateral"
    );
    if (result) {
      setAddCollateralId(null);
      setAddCollateralAmount("");
      fetchAll();
    }
  };

  const getPnl = (pos: PositionData) => {
    const entry = toUsd(pos.entryPrice);
    const collateral = toUsd(pos.collateral);
    const sizeUsd = toUsd(pos.sizeUsd);
    if (collateral === 0) return null;

    // For P2P positions: simulate reverse swap to get actual exit price
    if (pos.type === "p2p") {
      const vamm = vammByFeed.get(pos.feedId);
      if (!vamm || !vamm.active) return null;
      // reverseSwap math (VAMM.sol):
      // Long close: newQuote = vQuote - sizeUsd → exitPrice = newQuote / vBase
      // Short close: newQuote = vQuote + sizeUsd → exitPrice = newQuote / vBase
      const exitPrice = pos.isLong
        ? (vamm.vQuote - sizeUsd) / vamm.vBase
        : (vamm.vQuote + sizeUsd) / vamm.vBase;
      const priceChange = pos.isLong
        ? (exitPrice - entry) / entry
        : (entry - exitPrice) / entry;
      return {
        pnlPercent: priceChange * 100, // P2P is always 1x
        pnlUsd: collateral * priceChange,
      };
    }

    // For trading positions: use spot price (oracle-based)
    const currentPriceData = prices.find((p) => p.id === pos.feedId);
    if (!currentPriceData || currentPriceData.price <= 0) return null;
    const current = currentPriceData.price;
    const leverage = sizeUsd / collateral;
    const priceChange = pos.isLong
      ? (current - entry) / entry
      : (entry - current) / entry;
    return {
      pnlPercent: priceChange * leverage * 100,
      pnlUsd: collateral * priceChange * leverage,
    };
  };

  const MAINTENANCE_MARGIN = 0.1;
  const getLiquidationPrice = (pos: PositionData) => {
    const entry = toUsd(pos.entryPrice);
    const collateral = toUsd(pos.collateral);
    const sizeUsd = toUsd(pos.sizeUsd);
    if (collateral === 0) return 0;
    const leverage = sizeUsd / collateral;
    const moveToLiq = (1 - MAINTENANCE_MARGIN) / leverage;
    return pos.isLong ? entry * (1 - moveToLiq) : entry * (1 + moveToLiq);
  };

  const formatAge = (openedAt: string | undefined) => {
    if (!openedAt) return null;
    const openedMs = openedAt.includes("T")
      ? new Date(openedAt).getTime()
      : Number(openedAt) * 1000;
    const diffMs = now - openedMs;
    if (diffMs < 0) return null;
    const totalMins = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMins / 1440);
    const hrs = Math.floor((totalMins % 1440) / 60);
    const mins = totalMins % 60;
    let age = "";
    if (days > 0) age += `${days}d `;
    if (hrs > 0 || days > 0) age += `${hrs}h `;
    age += `${mins}m`;
    return age.trim();
  };

  const formatAbsoluteTime = (openedAt: string | undefined) => {
    if (!openedAt) return null;
    const date = openedAt.includes("T")
      ? new Date(openedAt)
      : new Date(Number(openedAt) * 1000);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  };

  if (!address) {
    return (
      <div
        className="rounded-lg p-4"
        style={{
          background: "linear-gradient(145deg, #1c1c1c 0%, #111111 50%, #181818 100%)",
          border: "1px solid rgba(255, 212, 0, 0.06)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1">
            {["Trading", "P2P", "History"].map((label) => (
              <span
                key={label}
                className="px-3 py-1.5 text-sm font-pixel rounded-md"
                style={{ color: "var(--dim-text)" }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <p className="text-sm font-pixel" style={{ color: "var(--dim-text)" }}>
          Connect wallet to view positions
        </p>
      </div>
    );
  }

  const positions =
    tab === "trading"
      ? tradingPositions
      : tab === "p2p"
        ? p2pPositions
        : historyPositions;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "trading", label: "Trading", count: tradingPositions.length },
    { key: "p2p", label: "P2P", count: p2pPositions.length },
    { key: "history", label: "History", count: historyPositions.length },
  ];

  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: "linear-gradient(145deg, #1c1c1c 0%, #111111 50%, #181818 100%)",
        border: "1px solid rgba(255, 212, 0, 0.06)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm font-pixel font-medium rounded-md transition-all ${tab === t.key
                ? "text-black font-bold"
                : "hover:bg-gray-800"
                }`}
              style={tab === t.key ? {
                background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
              } : { color: "var(--muted-text)" }}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === t.key
                    ? "bg-yellow-900 text-yellow-300"
                    : "bg-gray-800 text-gray-500"
                    }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="text-xs font-pixel hover:text-white transition-colors disabled:opacity-50"
          style={{ color: "var(--muted-text)" }}
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {loading && positions.length === 0 ? (
        <p className="text-sm font-pixel" style={{ color: "var(--dim-text)" }}>Loading...</p>
      ) : positions.length === 0 ? (
        <p className="text-sm font-pixel" style={{ color: "var(--dim-text)" }}>
          {tab === "history"
            ? "No position history"
            : `No open ${tab === "p2p" ? "P2P " : ""}positions`}
        </p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const pnl = pos.status === "open" || !pos.status ? getPnl(pos) : null;
            const collateral = toUsd(pos.collateral);
            const sizeUsd = toUsd(pos.sizeUsd);
            const leverage = collateral > 0 ? sizeUsd / collateral : 0;
            const isOpen = pos.status === "open" || !pos.status;
            const historyPnl = !isOpen && pos.realizedPnl ? (() => {
              const realized = toUsd(pos.realizedPnl);
              return { pnlUsd: realized, pnlPercent: collateral > 0 ? (realized / collateral) * 100 : 0 };
            })() : null;
            const feeCosts = pos.type === "trading" && isOpen ? getFeeCosts(pos) : null;

            return (
              <div
                key={`${pos.type}-${pos.positionId}`}
                className={`rounded-lg p-3 flex items-center justify-between transition-all ${!isOpen ? "opacity-60" : ""
                  }`}
                style={{
                  background: "linear-gradient(145deg, #1a1a1a 0%, #141414 50%, #1a1a1a 100%)",
                  border: isOpen ? "1px solid rgba(255, 215, 0, 0.08)" : "1px solid rgba(255, 255, 255, 0.03)",
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {pos.type === "p2p" && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-900 text-purple-400">
                        P2P
                      </span>
                    )}
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${pos.isLong
                        ? "bg-green-900 text-green-400"
                        : "bg-red-900 text-red-400"
                        }`}
                    >
                      {pos.isLong ? "LONG" : "SHORT"}
                    </span>
                    <span className="text-white text-sm font-medium">
                      {FEED_NAMES[pos.feedId] ?? `Feed ${pos.feedId}`}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {pos.type === "p2p" ? "Spot" : `${leverage.toFixed(1)}x`}
                    </span>
                    {pos.status && pos.status !== "open" && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${pos.status === "closed"
                          ? "bg-gray-700 text-gray-400"
                          : pos.status === "liquidated"
                            ? "bg-red-900/50 text-red-400"
                            : "bg-amber-900/50 text-amber-400"
                          }`}
                      >
                        {pos.status}
                      </span>
                    )}
                    {feeCosts && feeCosts.hoursToLiq < 1 && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-900 text-red-400 animate-pulse">
                        ⚠ LIQ RISK
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span>Size: ${sizeUsd.toFixed(0)}</span>
                    <span>
                      {pos.type === "p2p" ? "VAMM " : ""}Entry: $
                      {toUsd(pos.entryPrice).toFixed(2)}
                    </span>
                    <span>
                      Collateral: ${collateral.toFixed(2)}
                    </span>
                    {pos.type === "trading" && isOpen && (
                      <span className="text-orange-400">
                        Liq: ${getLiquidationPrice(pos).toFixed(2)}
                      </span>
                    )}
                    {pos.openedAt && (
                      <span className="text-gray-500" title={formatAbsoluteTime(pos.openedAt) ?? ""}>
                        {formatAge(pos.openedAt)} ago · {formatAbsoluteTime(pos.openedAt)}
                      </span>
                    )}
                  </div>
                  {feeCosts && feeCosts.totalPerHour > 0 && (
                    <div className="flex gap-4 mt-1 text-xs">
                      <span className="text-yellow-500">
                        Fees: ${feeCosts.totalPerHour.toFixed(2)}/hr
                      </span>
                      {feeCosts.accumulatedFees > 0 && (
                        <span className="text-orange-400">
                          Accrued: ~${feeCosts.accumulatedFees.toFixed(2)}
                        </span>
                      )}
                      {feeCosts.effectiveCollateral < collateral && (
                        <span className="text-gray-400">
                          Eff. Col: ${feeCosts.effectiveCollateral.toFixed(2)}
                        </span>
                      )}
                      {feeCosts.hoursToLiq < Infinity && (
                        <span className={feeCosts.hoursToLiq < 2 ? "text-red-400 font-bold" : "text-orange-400"}>
                          ~{feeCosts.hoursToLiq < 1
                            ? `${Math.max(Math.round(feeCosts.hoursToLiq * 60), 0)}min`
                            : `${feeCosts.hoursToLiq.toFixed(1)}hr`} to fee-liq
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {pnl && (
                    <div className="text-right">
                      <p
                        className={`text-sm font-mono ${pnl.pnlUsd >= 0 ? "text-yellow-400" : "text-red-400"
                          }`}
                      >
                        {pnl.pnlUsd >= 0 ? "+" : ""}
                        {pnl.pnlUsd.toFixed(2)} USD
                      </p>
                      <p
                        className={`text-xs ${pnl.pnlPercent >= 0
                          ? "text-yellow-500"
                          : "text-red-500"
                          }`}
                      >
                        {pnl.pnlPercent >= 0 ? "+" : ""}
                        {pnl.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  )}
                  {historyPnl && (
                    <div className="text-right">
                      <p
                        className={`text-sm font-mono ${historyPnl.pnlUsd >= 0 ? "text-yellow-400" : "text-red-400"
                          }`}
                      >
                        {historyPnl.pnlUsd >= 0 ? "+$" : "-$"}
                        {Math.abs(historyPnl.pnlUsd).toFixed(2)}
                      </p>
                      <p
                        className={`text-xs ${historyPnl.pnlPercent >= 0
                          ? "text-yellow-500"
                          : "text-red-500"
                          }`}
                      >
                        {historyPnl.pnlPercent >= 0 ? "+" : ""}
                        {historyPnl.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  )}
                  {pos.type === "p2p" && isOpen && (
                    <>
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-900 text-purple-400">
                        Active (P2P)
                      </span>
                      <button
                        onClick={() => handleCloseP2P(pos)}
                        disabled={isPending}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded disabled:opacity-50"
                      >
                        {isPending ? "..." : "Close"}
                      </button>
                    </>
                  )}
                  {pos.type === "trading" && isOpen && (
                    <>
                      {addCollateralId === pos.positionId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={addCollateralAmount}
                            onChange={(e) => setAddCollateralAmount(e.target.value)}
                            placeholder="USDC"
                            className="w-20 px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600 focus:border-blue-500 outline-none"
                          />
                          <button
                            onClick={() => handleAddCollateral(pos)}
                            disabled={isPending || !addCollateralAmount}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded disabled:opacity-50"
                          >
                            {isPending ? "..." : "OK"}
                          </button>
                          <button
                            onClick={() => { setAddCollateralId(null); setAddCollateralAmount(""); }}
                            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddCollateralId(pos.positionId)}
                          disabled={isPending}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded disabled:opacity-50"
                        >
                          +Col
                        </button>
                      )}
                      <button
                        onClick={() => handleClose(pos)}
                        disabled={isPending}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded disabled:opacity-50"
                      >
                        {isPending ? "..." : "Close"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "p2p" && positions.length > 0 && (
        <p className="text-xs text-gray-600 mt-2">
          P2P spot positions — close anytime at VAMM price, or hold for oracle settlement at market open
        </p>
      )}

      {pnlPopup && (
        <PnLPopup
          {...pnlPopup}
          onClose={() => setPnlPopup(null)}
        />
      )}
    </div>
  );
}

function mapRow(row: any, type: "trading" | "p2p"): PositionData {
  return {
    positionId: (row.positionId ?? row.id) as `0x${string}`,
    feedId: row.feedId,
    isLong: row.isLong,
    collateral: row.collateral?.toString() ?? "0",
    sizeUsd: row.sizeUsd?.toString() ?? "0",
    entryPrice: row.entryPrice?.toString() ?? "0",
    status: row.status,
    realizedPnl: row.realizedPnl?.toString() ?? undefined,
    type,
    openedAt: row.openedAt ?? row.openTimestamp,
  };
}
