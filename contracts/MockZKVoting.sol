// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockZKVoting — Testing version of ZKVoting
 * @notice Identical to ZKVoting but skips the cryptographic pairing check.
 *         Use ONLY in test environments (local Hardhat / Foundry).
 *
 * @dev    In production deploy ZKVoting.sol (which inherits real Groth16Verifier).
 *         This contract exists so that:
 *           1. Tests can run without needing compiled circuit artifacts
 *           2. All contract logic (nullifiers, registration, tally) is still tested
 *           3. The real verifier is unit-tested separately
 */
contract MockZKVoting {

    address public admin;
    string  public electionName;
    uint256 public numCandidates;
    bool    public votingOpen;

    mapping(uint256 => bool) public registeredCommitments;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(uint256 => uint256) public voteCounts;
    uint256 public totalVotes;

    event VoterRegistered(uint256 indexed commitment);
    event VoteCast(uint256 indexed nullifier, uint256 indexed candidate);
    event VotingStarted();
    event VotingEnded();

    modifier onlyAdmin() {
        require(msg.sender == admin, "MockZKVoting: not admin");
        _;
    }

    modifier whenOpen() {
        require(votingOpen, "MockZKVoting: voting is not open");
        _;
    }

    constructor(string memory _electionName, uint256 _numCandidates) {
        require(_numCandidates > 1, "need >= 2 candidates");
        admin         = msg.sender;
        electionName  = _electionName;
        numCandidates = _numCandidates;
        votingOpen    = false;
    }

    function registerVoter(uint256 commitment) external onlyAdmin {
        require(!registeredCommitments[commitment], "already registered");
        registeredCommitments[commitment] = true;
        emit VoterRegistered(commitment);
    }

    function registerVotersBatch(uint256[] calldata commitments) external onlyAdmin {
        for (uint256 i = 0; i < commitments.length; i++) {
            require(!registeredCommitments[commitments[i]], "duplicate commitment");
            registeredCommitments[commitments[i]] = true;
            emit VoterRegistered(commitments[i]);
        }
    }

    function startVoting() external onlyAdmin {
        require(!votingOpen, "already open");
        votingOpen = true;
        emit VotingStarted();
    }

    function endVoting() external onlyAdmin {
        require(votingOpen, "not open");
        votingOpen = false;
        emit VotingEnded();
    }

    /**
     * @notice Cast a vote.
     * @dev    Proof inputs are accepted but NOT cryptographically verified
     *         (mock). All other business logic is identical to ZKVoting.
     *
     * pubSignals layout: [commitment, nullifier, voteChoice, validVote]
     */
    function castVote(
        uint256[2]    calldata /*pA*/,
        uint256[2][2] calldata /*pB*/,
        uint256[2]    calldata /*pC*/,
        uint256[4]    calldata pubSignals
    ) external whenOpen {
        uint256 commitment = pubSignals[0];
        uint256 nullifier  = pubSignals[1];
        uint256 voteChoice = pubSignals[2];
        uint256 validVote  = pubSignals[3];

        // ── SKIPPED: verifyProof(pA, pB, pC, pubSignals) ──
        //    (Mock mode: trust the public signals directly)

        require(validVote == 1,                          "invalid proof output");
        require(registeredCommitments[commitment],       "commitment not registered");
        require(!usedNullifiers[nullifier],              "double-vote detected");
        require(voteChoice < numCandidates,              "invalid candidate");

        usedNullifiers[nullifier]  = true;
        voteCounts[voteChoice]    += 1;
        totalVotes                += 1;

        emit VoteCast(nullifier, voteChoice);
    }

    function getResults() external view returns (uint256[] memory counts) {
        counts = new uint256[](numCandidates);
        for (uint256 i = 0; i < numCandidates; i++) {
            counts[i] = voteCounts[i];
        }
    }

    function isNullifierUsed(uint256 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    function isRegistered(uint256 commitment) external view returns (bool) {
        return registeredCommitments[commitment];
    }
}
