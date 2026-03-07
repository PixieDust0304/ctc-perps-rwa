// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IGovernance} from "../interfaces/IGovernance.sol";

/// @title Governance
/// @notice PRPMAN-weighted DAO governance: propose, vote, execute
contract Governance is IGovernance, OwnableUpgradeable, UUPSUpgradeable {
    IERC20 public prpmanToken;

    uint256 public quorumBps;       // e.g., 2000 = 20%
    uint256 public majorityBps;     // e.g., 5100 = 51%
    uint256 public votingPeriod;    // e.g., 48 hours

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public proposalCount;

    event GovernanceConfigUpdated(string param, uint256 value);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address prpmanToken_,
        uint256 quorumBps_,
        uint256 majorityBps_,
        uint256 votingPeriod_
    ) external initializer {
        __Ownable_init(owner_);
        prpmanToken = IERC20(prpmanToken_);
        quorumBps = quorumBps_;
        majorityBps = majorityBps_;
        votingPeriod = votingPeriod_;
    }

    /// @notice Create a proposal
    function propose(address target, bytes calldata callData) external returns (uint256) {
        require(prpmanToken.balanceOf(msg.sender) > 0, "Governance: no voting power");

        proposalCount++;
        proposals[proposalCount] = Proposal({
            proposer: msg.sender,
            target: target,
            callData: callData,
            forVotes: 0,
            againstVotes: 0,
            deadline: block.timestamp + votingPeriod,
            executed: false
        });

        emit ProposalCreated(proposalCount, msg.sender, target);
        return proposalCount;
    }

    /// @notice Vote on a proposal
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.proposer != address(0), "Governance: invalid proposal");
        require(block.timestamp <= p.deadline, "Governance: voting ended");
        require(!hasVoted[proposalId][msg.sender], "Governance: already voted");

        uint256 weight = prpmanToken.balanceOf(msg.sender);
        require(weight > 0, "Governance: no voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    /// @notice Execute a passed proposal
    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.proposer != address(0), "Governance: invalid proposal");
        require(block.timestamp > p.deadline, "Governance: voting not ended");
        require(!p.executed, "Governance: already executed");

        uint256 totalSupply = prpmanToken.totalSupply();
        uint256 totalVotes = p.forVotes + p.againstVotes;

        // Quorum check
        require(
            totalVotes * 10_000 >= totalSupply * quorumBps,
            "Governance: quorum not met"
        );

        // Majority check
        require(
            p.forVotes * 10_000 >= totalVotes * majorityBps,
            "Governance: majority not met"
        );

        p.executed = true;

        (bool success, ) = p.target.call(p.callData);
        require(success, "Governance: execution failed");

        emit ProposalExecuted(proposalId);
    }

    // Admin setters (can also be changed via governance)
    function setQuorumBps(uint256 bps) external onlyOwner {
        quorumBps = bps;
        emit GovernanceConfigUpdated("quorumBps", bps);
    }

    function setMajorityBps(uint256 bps) external onlyOwner {
        majorityBps = bps;
        emit GovernanceConfigUpdated("majorityBps", bps);
    }

    function setVotingPeriod(uint256 period) external onlyOwner {
        votingPeriod = period;
        emit GovernanceConfigUpdated("votingPeriod", period);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
