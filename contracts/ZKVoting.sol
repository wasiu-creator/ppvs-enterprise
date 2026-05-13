// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Verifier.sol";

/**
 * @title ZKVoting — Privacy-Preserving Voting via Zero-Knowledge Proofs
 * @notice Voters prove eligibility and cast a vote WITHOUT revealing their identity.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  HOW IT WORKS (high-level)                                     │
 * │                                                                │
 * │  1. REGISTRATION (off-chain → on-chain)                        │
 * │     - Voter computes: commitment = Poseidon(secret, nullSec)   │
 * │     - Admin registers the commitment on-chain.                 │
 * │     - Nobody (not even admin) can reverse-derive the secrets.  │
 * │                                                                │
 * │  2. VOTING (off-chain proof → on-chain verification)           │
 * │     - Voter generates a ZK proof off-chain proving:            │
 * │         a) They know preimage of a registered commitment       │
 * │         b) Their nullifier = Poseidon(nullSec) is fresh        │
 * │         c) Their voteChoice is in [0, numCandidates)           │
 * │     - Voter submits: proof + publicSignals to the contract.    │
 * │     - Contract verifies proof → records nullifier + vote.      │
 * │     - If nullifier was seen before → REJECT (double-vote).     │
 * │                                                                │
 * │  3. TALLY                                                      │
 * │     - Anyone can read vote counts per candidate.               │
 * │     - No mapping from nullifier → voter identity exists.       │
 * └────────────────────────────────────────────────────────────────┘
 */
contract ZKVoting is Groth16Verifier {

    // ── State ────────────────────────────────────────────────────────────

    address public admin;
    string  public electionName;
    uint256 public numCandidates;
    bool    public votingOpen;

    // Registered voter commitments (commitment → registered)
    mapping(uint256 => bool) public registeredCommitments;

    // Used nullifiers (prevents double-voting)
    mapping(uint256 => bool) public usedNullifiers;

    // Vote tally per candidate
    mapping(uint256 => uint256) public voteCounts;

    // Total votes cast
    uint256 public totalVotes;

    // ── Events ───────────────────────────────────────────────────────────

    event VoterRegistered(uint256 indexed commitment);
    event VoteCast(uint256 indexed nullifier, uint256 indexed candidate);
    event VotingStarted();
    event VotingEnded();

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "ZKVoting: not admin");
        _;
    }

    modifier whenOpen() {
        require(votingOpen, "ZKVoting: voting is not open");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(string memory _electionName, uint256 _numCandidates) {
        require(_numCandidates > 1, "ZKVoting: need at least 2 candidates");
        admin         = msg.sender;
        electionName  = _electionName;
        numCandidates = _numCandidates;
        votingOpen    = false;
    }

    // ── Admin functions ──────────────────────────────────────────────────

    /**
     * @notice Register a voter by their cryptographic commitment.
     * @dev    The commitment = Poseidon(secret, nullifierSecret), computed off-chain.
     *         The admin never learns the voter's secrets.
     * @param  commitment  The voter's Poseidon commitment hash.
     */
    function registerVoter(uint256 commitment) external onlyAdmin {
        require(!registeredCommitments[commitment], "ZKVoting: already registered");
        registeredCommitments[commitment] = true;
        emit VoterRegistered(commitment);
    }

    /**
     * @notice Register multiple voters in one transaction.
     */
    function registerVotersBatch(uint256[] calldata commitments) external onlyAdmin {
        for (uint256 i = 0; i < commitments.length; i++) {
            require(!registeredCommitments[commitments[i]], "ZKVoting: duplicate commitment");
            registeredCommitments[commitments[i]] = true;
            emit VoterRegistered(commitments[i]);
        }
    }

    /// @notice Open the polls.
    function startVoting() external onlyAdmin {
        require(!votingOpen, "ZKVoting: already open");
        votingOpen = true;
        emit VotingStarted();
    }

    /// @notice Close the polls.
    function endVoting() external onlyAdmin {
        require(votingOpen, "ZKVoting: not open");
        votingOpen = false;
        emit VotingEnded();
    }

    // ── Core: cast a private vote ─────────────────────────────────────────

    /**
     * @notice Cast a vote using a Zero-Knowledge proof.
     *
     * @param  pA           Proof component A (Groth16)
     * @param  pB           Proof component B (Groth16)
     * @param  pC           Proof component C (Groth16)
     * @param  pubSignals   Public signals: [commitment, nullifier, voteChoice, validVote]
     *
     * The ZK proof guarantees (without revealing secrets):
     *   ✓ The voter knows the preimage of a registered commitment
     *   ✓ The nullifier is correctly derived (no forgery)
     *   ✓ The voteChoice is within valid range
     */
    function castVote(
        uint256[2]    calldata pA,
        uint256[2][2] calldata pB,
        uint256[2]    calldata pC,
        uint256[4]    calldata pubSignals
    ) external whenOpen {
        // pubSignals layout (matches circuit main {public [...]}):
        //   [0] = commitment
        //   [1] = nullifier
        //   [2] = voteChoice
        //   [3] = validVote (output = 1)
        uint256 commitment  = pubSignals[0];
        uint256 nullifier   = pubSignals[1];
        uint256 voteChoice  = pubSignals[2];
        uint256 validVote   = pubSignals[3];

        // 1. Verify the ZK proof cryptographically
        require(
            verifyProof(pA, pB, pC, pubSignals),
            "ZKVoting: invalid ZK proof"
        );

        // 2. Verify the circuit output flag
        require(validVote == 1, "ZKVoting: proof output invalid");

        // 3. Commitment must be registered
        require(
            registeredCommitments[commitment],
            "ZKVoting: commitment not registered"
        );

        // 4. Nullifier must be fresh (prevents double-voting)
        require(
            !usedNullifiers[nullifier],
            "ZKVoting: vote already cast (double-vote detected)"
        );

        // 5. Vote choice must be in range (circuit also enforces this,
        //    but we double-check at the contract level)
        require(voteChoice < numCandidates, "ZKVoting: invalid candidate");

        // ── All checks passed — record the vote ──
        usedNullifiers[nullifier]  = true;
        voteCounts[voteChoice]    += 1;
        totalVotes                += 1;

        emit VoteCast(nullifier, voteChoice);
    }

    // ── View functions ───────────────────────────────────────────────────

    /**
     * @notice Get vote counts for all candidates.
     */
    function getResults() external view returns (uint256[] memory counts) {
        counts = new uint256[](numCandidates);
        for (uint256 i = 0; i < numCandidates; i++) {
            counts[i] = voteCounts[i];
        }
    }

    /**
     * @notice Check if a nullifier has already been used.
     */
    function isNullifierUsed(uint256 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }

    /**
     * @notice Check if a commitment is registered.
     */
    function isRegistered(uint256 commitment) external view returns (bool) {
        return registeredCommitments[commitment];
    }
}
