"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  usePublicClient,
} from "wagmi";
import { type Address, encodeFunctionData } from "viem";
import { CONTRACTS, ERC20_ABI } from "../../lib/contracts";
import { useContractWrite } from "../../hooks/useContractWrite";

const GOVERNANCE_ABI = [
  {
    name: "propose",
    type: "function",
    inputs: [
      { name: "target", type: "address" },
      { name: "callData", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "vote",
    type: "function",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "execute",
    type: "function",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "proposalCount",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "proposals",
    type: "function",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "proposer", type: "address" },
      { name: "target", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "forVotes", type: "uint256" },
      { name: "againstVotes", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "executed", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

// Preset governance actions — common admin functions across contracts
const PRESET_ACTIONS = [
  {
    label: "Set Max Leverage (Trading)",
    target: () => CONTRACTS.trading,
    abi: [{ name: "setMaxLeverage", type: "function", inputs: [{ name: "lev", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setMaxLeverage" as const,
    paramLabel: "Max leverage (18-decimal, e.g. 100e18 = 100x)",
    paramType: "uint256" as const,
  },
  {
    label: "Set Maintenance Margin (Trading)",
    target: () => CONTRACTS.trading,
    abi: [{ name: "setMaintenanceMarginBps", type: "function", inputs: [{ name: "bps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setMaintenanceMarginBps" as const,
    paramLabel: "Maintenance margin (bps, e.g. 3000 = 30%)",
    paramType: "uint256" as const,
  },
  {
    label: "Set Open/Close Fee (FeeManager)",
    target: () => CONTRACTS.feeManager,
    abi: [{ name: "setOpenCloseFeeBps", type: "function", inputs: [{ name: "bps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setOpenCloseFeeBps" as const,
    paramLabel: "Fee (bps, e.g. 10 = 0.1%)",
    paramType: "uint256" as const,
  },
  {
    label: "Set LP Share (Pool)",
    target: () => CONTRACTS.pool,
    abi: [{ name: "setLpShareBps", type: "function", inputs: [{ name: "bps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setLpShareBps" as const,
    paramLabel: "LP share of fees (bps, e.g. 7000 = 70%)",
    paramType: "uint256" as const,
  },
  {
    label: "Set Oracle Staleness Threshold",
    target: () => CONTRACTS.oracle,
    abi: [{ name: "setStalenessThreshold", type: "function", inputs: [{ name: "threshold", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setStalenessThreshold" as const,
    paramLabel: "Staleness threshold (seconds, e.g. 60)",
    paramType: "uint256" as const,
  },
  {
    label: "Pause Trading",
    target: () => CONTRACTS.trading,
    abi: [{ name: "pause", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "pause" as const,
    paramLabel: null,
    paramType: null,
  },
  {
    label: "Unpause Trading",
    target: () => CONTRACTS.trading,
    abi: [{ name: "unpause", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "unpause" as const,
    paramLabel: null,
    paramType: null,
  },
  {
    label: "Set P2P Max Leverage",
    target: () => CONTRACTS.p2pTrading,
    abi: [{ name: "setMaxLeverage", type: "function", inputs: [{ name: "lev", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }] as const,
    functionName: "setMaxLeverage" as const,
    paramLabel: "Max leverage (18-decimal, e.g. 50e18 = 50x)",
    paramType: "uint256" as const,
  },
] as const;

interface ProposalData {
  id: number;
  proposer: string;
  target: string;
  forVotes: bigint;
  againstVotes: bigint;
  deadline: bigint;
  executed: boolean;
}

export function GovernancePanel() {
  const { address, isConnected } = useAccount();
  const { execute, isPending } = useContractWrite();
  const publicClient = usePublicClient();
  const [proposals, setProposals] = useState<ProposalData[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [paramValue, setParamValue] = useState("");
  const [customTarget, setCustomTarget] = useState("");
  const [customCalldata, setCustomCalldata] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  // PRPMAN balance (voting power)
  const { data: prpmanBalance } = useReadContract({
    address: CONTRACTS.prpman as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address && !!CONTRACTS.prpman, refetchInterval: 10000 },
  });

  const { data: proposalCount } = useReadContract({
    address: CONTRACTS.governance as Address,
    abi: GOVERNANCE_ABI,
    functionName: "proposalCount",
    query: { enabled: !!CONTRACTS.governance, refetchInterval: 10000 },
  });

  const fetchProposals = useCallback(async () => {
    if (!publicClient || !CONTRACTS.governance || !proposalCount) return;
    const count = Number(proposalCount);
    if (count === 0) return;

    const items: ProposalData[] = [];
    for (let i = count; i >= Math.max(1, count - 9); i--) {
      try {
        const result = await publicClient.readContract({
          address: CONTRACTS.governance as Address,
          abi: GOVERNANCE_ABI,
          functionName: "proposals",
          args: [BigInt(i)],
        });
        const [proposer, target, , forVotes, againstVotes, deadline, executed] =
          result as [string, string, string, bigint, bigint, bigint, boolean];
        items.push({
          id: i,
          proposer,
          target,
          forVotes,
          againstVotes,
          deadline,
          executed,
        });
      } catch {
        break;
      }
    }
    setProposals(items);
  }, [publicClient, proposalCount]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleVote = (proposalId: number, support: boolean) => {
    if (!CONTRACTS.governance) return;
    execute(
      {
        address: CONTRACTS.governance as Address,
        abi: GOVERNANCE_ABI,
        functionName: "vote",
        args: [BigInt(proposalId), support],
      },
      `Voting ${support ? "For" : "Against"} #${proposalId}`
    );
  };

  const handleExecute = (proposalId: number) => {
    if (!CONTRACTS.governance) return;
    execute(
      {
        address: CONTRACTS.governance as Address,
        abi: GOVERNANCE_ABI,
        functionName: "execute",
        args: [BigInt(proposalId)],
      },
      `Executing proposal #${proposalId}`
    );
  };

  const handlePropose = async () => {
    if (!CONTRACTS.governance) return;

    let target: string;
    let callData: `0x${string}`;

    if (useCustom) {
      target = customTarget;
      callData = customCalldata as `0x${string}`;
    } else {
      const preset = PRESET_ACTIONS[selectedPreset];
      target = preset.target();
      if (preset.paramType) {
        callData = encodeFunctionData({
          abi: preset.abi,
          functionName: preset.functionName,
          args: [BigInt(paramValue)],
        });
      } else {
        callData = encodeFunctionData({
          abi: preset.abi,
          functionName: preset.functionName,
        });
      }
    }

    if (!target) return;

    await execute(
      {
        address: CONTRACTS.governance as Address,
        abi: GOVERNANCE_ABI,
        functionName: "propose",
        args: [target as Address, callData],
      },
      "Submitting proposal"
    );

    setShowCreateForm(false);
    setParamValue("");
    setCustomTarget("");
    setCustomCalldata("");
  };

  const now = BigInt(Math.floor(Date.now() / 1000));
  const votingPower = prpmanBalance
    ? Number(prpmanBalance as bigint) / 1e18
    : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div
        className="rounded-xl p-6"
        style={{
          background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
          border: "1px solid var(--coal-border)",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-pixel font-bold uppercase tracking-wider" style={{ color: "var(--pixel-yellow)" }}>Governance</h2>
          {isConnected && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="px-4 py-1.5 rounded-xl font-pixel font-bold text-sm text-black transition-all hover:brightness-110"
              style={{
                background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
                boxShadow: "0 4px 12px var(--pixel-yellow-glow), inset 0 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              {showCreateForm ? "Cancel" : "New Proposal"}
            </button>
          )}
        </div>
        <p className="text-xs font-pixel" style={{ color: "var(--muted-text)" }}>
          Vote on protocol changes with PRPMAN tokens
        </p>
        {isConnected && (
          <div className="mt-4 flex gap-8">
            <div>
              <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Your Voting Power</p>
              <p className="text-lg font-mono font-bold" style={{ color: "#A855F7" }}>
                {votingPower.toLocaleString()} <span className="text-xs" style={{ color: "var(--muted-text)" }}>PRPMAN</span>
              </p>
            </div>
            <div>
              <p className="text-xs font-pixel uppercase tracking-wider mb-1" style={{ color: "var(--muted-text)" }}>Active Proposals</p>
              <p className="text-lg font-mono font-bold" style={{ color: "var(--pixel-yellow)" }}>
                {proposals.filter((p) => p.deadline > now && !p.executed).length}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Proposal Form */}
      {showCreateForm && isConnected && (
        <div
          className="rounded-xl p-6"
          style={{
            background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4), 0 0 20px rgba(168, 85, 247, 0.05)",
          }}
        >
          <h3 className="text-sm font-pixel font-bold uppercase tracking-wider mb-4" style={{ color: "#A855F7" }}>Create Proposal</h3>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUseCustom(false)}
              className="px-3 py-1.5 rounded-lg font-pixel text-xs font-bold transition-all"
              style={!useCustom ? {
                background: "linear-gradient(135deg, #A855F7, #7C3AED)",
                color: "#fff",
                boxShadow: "0 2px 8px rgba(168, 85, 247, 0.3)",
              } : {
                background: "var(--coal-lighter)",
                border: "1px solid var(--coal-border)",
                color: "var(--muted-text)",
              }}
            >
              Preset Actions
            </button>
            <button
              onClick={() => setUseCustom(true)}
              className="px-3 py-1.5 rounded-lg font-pixel text-xs font-bold transition-all"
              style={useCustom ? {
                background: "linear-gradient(135deg, #A855F7, #7C3AED)",
                color: "#fff",
                boxShadow: "0 2px 8px rgba(168, 85, 247, 0.3)",
              } : {
                background: "var(--coal-lighter)",
                border: "1px solid var(--coal-border)",
                color: "var(--muted-text)",
              }}
            >
              Custom Calldata
            </button>
          </div>

          {!useCustom ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-pixel uppercase tracking-wider block mb-1" style={{ color: "var(--dim-text)" }}>Action</label>
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    setSelectedPreset(Number(e.target.value));
                    setParamValue("");
                  }}
                  className="w-full rounded-xl px-3 py-2.5 text-white font-body text-sm outline-none"
                  style={{
                    background: "var(--void-black)",
                    border: "1px solid var(--coal-border)",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                  }}
                >
                  {PRESET_ACTIONS.map((action, i) => (
                    <option key={i} value={i}>{action.label}</option>
                  ))}
                </select>
              </div>

              {PRESET_ACTIONS[selectedPreset].paramLabel && (
                <div>
                  <label className="text-xs font-pixel uppercase tracking-wider block mb-1" style={{ color: "var(--dim-text)" }}>
                    {PRESET_ACTIONS[selectedPreset].paramLabel}
                  </label>
                  <input
                    type="text"
                    value={paramValue}
                    onChange={(e) => setParamValue(e.target.value)}
                    placeholder="Enter value"
                    className="w-full rounded-xl px-3 py-2.5 text-white font-body text-sm outline-none"
                    style={{
                      background: "var(--void-black)",
                      border: "1px solid var(--coal-border)",
                      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                    }}
                  />
                </div>
              )}

              <div className="text-xs font-pixel" style={{ color: "var(--dim-text)" }}>
                Target: {PRESET_ACTIONS[selectedPreset].target()
                  ? <span style={{ color: "#A855F7" }}>{`${PRESET_ACTIONS[selectedPreset].target().slice(0, 6)}...${PRESET_ACTIONS[selectedPreset].target().slice(-4)}`}</span>
                  : "Not configured"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-pixel uppercase tracking-wider block mb-1" style={{ color: "var(--dim-text)" }}>Target Address</label>
                <input
                  type="text"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-xl px-3 py-2.5 text-white font-mono text-sm outline-none"
                  style={{
                    background: "var(--void-black)",
                    border: "1px solid var(--coal-border)",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-pixel uppercase tracking-wider block mb-1" style={{ color: "var(--dim-text)" }}>Calldata (hex)</label>
                <input
                  type="text"
                  value={customCalldata}
                  onChange={(e) => setCustomCalldata(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-xl px-3 py-2.5 text-white font-mono text-sm outline-none"
                  style={{
                    background: "var(--void-black)",
                    border: "1px solid var(--coal-border)",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                  }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handlePropose}
            disabled={isPending || (!useCustom && PRESET_ACTIONS[selectedPreset].paramLabel && !paramValue) || (useCustom && (!customTarget || !customCalldata))}
            className="w-full mt-4 py-2.5 rounded-xl font-pixel font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
            style={{
              background: isPending ? "#2d1a4e" : "linear-gradient(135deg, #A855F7, #7C3AED)",
              boxShadow: isPending ? "none" : "0 4px 16px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            {isPending ? "Submitting..." : "Submit Proposal"}
          </button>
        </div>
      )}

      {/* Proposals */}
      <div className="space-y-3">
        {proposals.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center font-pixel text-sm"
            style={{
              background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
              border: "1px solid var(--coal-border)",
              color: "var(--muted-text)",
            }}
          >
            No proposals yet
          </div>
        ) : (
          proposals.map((p) => {
            const isActive = p.deadline > now && !p.executed;
            const isExpired = p.deadline <= now && !p.executed;
            const totalVotes = p.forVotes + p.againstVotes;
            const forPercent =
              totalVotes > 0n
                ? Number((p.forVotes * 100n) / totalVotes)
                : 0;

            return (
              <div
                key={p.id}
                className="rounded-xl p-4"
                style={{
                  background: "linear-gradient(160deg, var(--coal-surface) 0%, var(--void-black) 100%)",
                  border: `1px solid ${isActive ? "rgba(168, 85, 247, 0.15)" : "var(--coal-border)"}`,
                  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-pixel font-bold text-sm" style={{ color: "var(--soft-white)" }}>
                      Proposal #{p.id}
                    </span>
                    <span
                      className="text-[10px] font-pixel font-bold px-2 py-0.5 rounded-lg uppercase"
                      style={
                        p.executed
                          ? { background: "rgba(0, 230, 118, 0.1)", color: "#00E676", border: "1px solid rgba(0, 230, 118, 0.2)" }
                          : isActive
                            ? { background: "rgba(168, 85, 247, 0.1)", color: "#A855F7", border: "1px solid rgba(168, 85, 247, 0.2)" }
                            : { background: "var(--coal-lighter)", color: "var(--muted-text)", border: "1px solid var(--coal-border)" }
                      }
                    >
                      {p.executed
                        ? "Executed"
                        : isActive
                          ? "Active"
                          : "Ended"}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono" style={{ color: "var(--dim-text)" }}>
                    {p.target.slice(0, 6)}...{p.target.slice(-4)}
                  </span>
                </div>

                {/* Vote bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] font-pixel uppercase mb-1" style={{ color: "var(--muted-text)" }}>
                    <span>
                      For: <span style={{ color: "var(--pixel-yellow)" }}>{(Number(p.forVotes) / 1e18).toLocaleString()}</span>
                    </span>
                    <span>
                      Against:{" "}
                      <span style={{ color: "var(--trade-red, #FF1744)" }}>{(Number(p.againstVotes) / 1e18).toLocaleString()}</span>
                    </span>
                  </div>
                  <div className="w-full rounded-full h-2" style={{ background: "var(--coal-lighter)" }}>
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${forPercent}%`,
                        background: "linear-gradient(90deg, var(--pixel-yellow), var(--arcade-orange))",
                        boxShadow: forPercent > 0 ? "0 0 8px var(--pixel-yellow-glow)" : "none",
                      }}
                    />
                  </div>
                </div>

                {/* Actions */}
                {isActive && isConnected && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleVote(p.id, true)}
                      disabled={isPending}
                      className="flex-1 py-1.5 rounded-lg font-pixel font-bold text-xs text-black transition-all disabled:opacity-50 hover:brightness-110"
                      style={{
                        background: "linear-gradient(135deg, var(--pixel-yellow), var(--arcade-orange))",
                        boxShadow: "0 2px 8px var(--pixel-yellow-glow)",
                      }}
                    >
                      Vote For
                    </button>
                    <button
                      onClick={() => handleVote(p.id, false)}
                      disabled={isPending}
                      className="flex-1 py-1.5 rounded-lg font-pixel font-bold text-xs text-white transition-all disabled:opacity-50 hover:brightness-110"
                      style={{
                        background: "linear-gradient(135deg, #FF1744, #D50000)",
                        boxShadow: "0 2px 8px rgba(255, 23, 68, 0.3)",
                      }}
                    >
                      Vote Against
                    </button>
                  </div>
                )}
                {isExpired && !p.executed && isConnected && (
                  <button
                    onClick={() => handleExecute(p.id)}
                    disabled={isPending}
                    className="w-full mt-3 py-1.5 rounded-lg font-pixel font-bold text-xs text-white transition-all disabled:opacity-50 hover:brightness-110"
                    style={{
                      background: "linear-gradient(135deg, #A855F7, #7C3AED)",
                      boxShadow: "0 2px 8px rgba(168, 85, 247, 0.3)",
                    }}
                  >
                    Execute
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
