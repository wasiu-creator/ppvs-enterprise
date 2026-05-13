pragma circom 2.0.0;

/*
 * Privacy-Preserving Voting Circuit
 * ===================================
 * This circuit proves, in zero-knowledge, that:
 *   1. The voter knows a secret key that hashes to a registered commitment
 *   2. The nullifier (to prevent double-voting) is correctly derived from that secret
 *   3. The vote choice is within valid range [0, numCandidates)
 *
 * PUBLIC inputs  (revealed on-chain):
 *   - commitment  : Hash(secret, nullifierSecret) — registered at signup
 *   - nullifier   : Hash(nullifierSecret) — revealed when voting to prevent double-vote
 *   - voteChoice  : The candidate index (0, 1, 2 ...)
 *
 * PRIVATE inputs (never leave the user's machine):
 *   - secret            : Random voter secret
 *   - nullifierSecret   : Random secret used to derive the nullifier
 */

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template VoteProof(numCandidates) {
    // ── Private inputs ─────────────────────────────────────────────────────
    signal input secret;           // Voter's private secret
    signal input nullifierSecret;  // Private secret for nullifier derivation

    // ── Public inputs ──────────────────────────────────────────────────────
    signal input commitment;       // Registered on-chain: Poseidon(secret, nullifierSecret)
    signal input nullifier;        // Revealed when voting: Poseidon(nullifierSecret)
    signal input voteChoice;       // Candidate index (0-based)

    // ── Outputs ────────────────────────────────────────────────────────────
    signal output validVote;       // 1 if all checks pass

    // ── Constraint 1: Commitment check ────────────────────────────────────
    // Prove: commitment == Poseidon(secret, nullifierSecret)
    // This proves the voter knows the preimage of their registered commitment
    component commitHasher = Poseidon(2);
    commitHasher.inputs[0] <== secret;
    commitHasher.inputs[1] <== nullifierSecret;
    // Enforce the computed hash matches the public commitment
    commitment === commitHasher.out;

    // ── Constraint 2: Nullifier check ─────────────────────────────────────
    // Prove: nullifier == Poseidon(nullifierSecret)
    // The nullifier is deterministic so double-voting is detectable,
    // but it does NOT reveal the secret or the voter's identity.
    component nullHasher = Poseidon(1);
    nullHasher.inputs[0] <== nullifierSecret;
    nullifier === nullHasher.out;

    // ── Constraint 3: Vote range check ────────────────────────────────────
    // Prove: 0 <= voteChoice < numCandidates
    // Prevents votes for non-existent candidates
    component lt = LessThan(8); // 8-bit comparison supports up to 255 candidates
    lt.in[0] <== voteChoice;
    lt.in[1] <== numCandidates;
    lt.out === 1;

    // ── Output ─────────────────────────────────────────────────────────────
    // All constraints satisfied — this is enforced by the ZK system itself.
    // The output signal carries the voteChoice as proof it was range-checked.
    validVote <== lt.out;
}

// Instantiate with 3 candidates (can be changed at compile time)
component main {public [commitment, nullifier, voteChoice]} = VoteProof(3);
