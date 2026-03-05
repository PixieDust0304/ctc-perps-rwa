// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGovernance {
    struct Proposal {
        address proposer;
        address target;
        bytes callData;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 deadline;
        bool executed;
    }

    event ProposalCreated(uint256 indexed proposalId, address proposer, address target);
    event Voted(uint256 indexed proposalId, address voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);

    function propose(address target, bytes calldata callData) external returns (uint256);
    function vote(uint256 proposalId, bool support) external;
    function execute(uint256 proposalId) external;
}
