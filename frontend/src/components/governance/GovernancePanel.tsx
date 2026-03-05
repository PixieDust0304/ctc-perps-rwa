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

  // CPERP balance (voting power)
  const { data: cperpBalance } = useReadContract({
    address: CONTRACTS.cperp as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address && !!CONTRACTS.cperp, refetchInterval: 10000 },
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
  const votingPower = cperpBalance
    ? Number(cperpBalance as bigint) / 1e18
    : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-white">Governance</h2>
          {isConnected && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded"
            >
              {showCreateForm ? "Cancel" : "New Proposal"}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400">
          Vote on protocol changes with CPERP tokens
        </p>
        {isConnected && (
          <div className="mt-3 flex gap-6">
            <div>
              <p className="text-xs text-gray-500">Your Voting Power</p>
              <p className="text-lg font-mono text-white">
                {votingPower.toLocaleString()} CPERP
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Active Proposals</p>
              <p className="text-lg font-mono text-white">
                {proposals.filter((p) => p.deadline > now && !p.executed).length}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Proposal Form */}
      {showCreateForm && isConnected && (
        <div className="bg-gray-900 rounded-lg p-6 border border-blue-800">
          <h3 className="text-lg font-bold text-white mb-4">Create Proposal</h3>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUseCustom(false)}
              className={`px-3 py-1 text-sm rounded ${!useCustom ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400"}`}
            >
              Preset Actions
            </button>
            <button
              onClick={() => setUseCustom(true)}
              className={`px-3 py-1 text-sm rounded ${useCustom ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400"}`}
            >
              Custom Calldata
            </button>
          </div>

          {!useCustom ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Action</label>
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    setSelectedPreset(Number(e.target.value));
                    setParamValue("");
                  }}
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700"
                >
                  {PRESET_ACTIONS.map((action, i) => (
                    <option key={i} value={i}>{action.label}</option>
                  ))}
                </select>
              </div>

              {PRESET_ACTIONS[selectedPreset].paramLabel && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    {PRESET_ACTIONS[selectedPreset].paramLabel}
                  </label>
                  <input
                    type="text"
                    value={paramValue}
                    onChange={(e) => setParamValue(e.target.value)}
                    placeholder="Enter value"
                    className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700"
                  />
                </div>
              )}

              <div className="text-xs text-gray-500">
                Target: {PRESET_ACTIONS[selectedPreset].target()
                  ? `${PRESET_ACTIONS[selectedPreset].target().slice(0, 6)}...${PRESET_ACTIONS[selectedPreset].target().slice(-4)}`
                  : "Not configured"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Target Address</label>
                <input
                  type="text"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm font-mono border border-gray-700"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Calldata (hex)</label>
                <input
                  type="text"
                  value={customCalldata}
                  onChange={(e) => setCustomCalldata(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm font-mono border border-gray-700"
                />
              </div>
            </div>
          )}

          <button
            onClick={handlePropose}
            disabled={isPending || (!useCustom && PRESET_ACTIONS[selectedPreset].paramLabel && !paramValue) || (useCustom && (!customTarget || !customCalldata))}
            className="w-full mt-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {isPending ? "Submitting..." : "Submit Proposal"}
          </button>
        </div>
      )}

      {/* Proposals */}
      <div className="space-y-3">
        {proposals.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-6 text-center text-gray-500">
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
              <div key={p.id} className="bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">
                      Proposal #{p.id}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        p.executed
                          ? "bg-green-900 text-green-400"
                          : isActive
                            ? "bg-blue-900 text-blue-400"
                            : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {p.executed
                        ? "Executed"
                        : isActive
                          ? "Active"
                          : "Ended"}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Target: {p.target.slice(0, 6)}...{p.target.slice(-4)}
                  </span>
                </div>

                {/* Vote bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>
                      For: {(Number(p.forVotes) / 1e18).toLocaleString()}
                    </span>
                    <span>
                      Against:{" "}
                      {(Number(p.againstVotes) / 1e18).toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${forPercent}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                {isActive && isConnected && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleVote(p.id, true)}
                      disabled={isPending}
                      className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded disabled:opacity-50"
                    >
                      Vote For
                    </button>
                    <button
                      onClick={() => handleVote(p.id, false)}
                      disabled={isPending}
                      className="flex-1 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm rounded disabled:opacity-50"
                    >
                      Vote Against
                    </button>
                  </div>
                )}
                {isExpired && !p.executed && isConnected && (
                  <button
                    onClick={() => handleExecute(p.id)}
                    disabled={isPending}
                    className="w-full mt-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded disabled:opacity-50"
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
