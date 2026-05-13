/**
 * zkHelpers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Utility functions for the Privacy-Preserving Voting System.
 *
 * Provides:
 *   - Poseidon hashing (same hash used inside the Circom circuit)
 *   - Voter commitment / nullifier generation
 *   - ZK proof generation via snarkjs
 *   - Proof formatting for Solidity calldata
 *   - Mock proof mode (when circuit artifacts don't exist yet)
 *
 * Usage:
 *   const zkHelpers = require('./zkHelpers');
 *   const voter = zkHelpers.createVoter();
 *   const proof = await zkHelpers.generateVoteProof(voter, 1 /* candidateIndex *\/);
 */

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");

// ── Paths to circuit artifacts ────────────────────────────────────────────────
const ARTIFACTS_DIR = path.join(__dirname, "../artifacts/circuits");
const WASM_PATH     = path.join(ARTIFACTS_DIR, "vote_js/vote.wasm");
const ZKEY_PATH     = path.join(ARTIFACTS_DIR, "vote_final.zkey");

// ── Singleton Poseidon instance ───────────────────────────────────────────────
let _poseidon = null;
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/**
 * Compute Poseidon hash of 1 or 2 field elements.
 * Returns a BigInt (matches snarkjs field element format).
 */
async function poseidon(inputs) {
  const pos = await getPoseidon();
  const hash = pos(inputs);
  return pos.F.toObject(hash);
}

// ── Voter identity helpers ────────────────────────────────────────────────────

/**
 * Generate a cryptographically random field element.
 */
function randomFieldElement() {
  // BN254 scalar field size
  const FIELD_MOD = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
  );
  const rand = BigInt("0x" + Buffer.from(ethers.randomBytes(32)).toString("hex"));
  return rand % FIELD_MOD;
}

/**
 * Create a new voter identity.
 * Returns: { secret, nullifierSecret, commitment, nullifier }
 *
 * - secret + nullifierSecret are kept private by the voter
 * - commitment is registered on-chain
 * - nullifier is revealed when voting (to prevent double-voting)
 */
async function createVoter() {
  const secret          = randomFieldElement();
  const nullifierSecret = randomFieldElement();

  // These match exactly what the Circom circuit computes:
  const commitment = await poseidon([secret, nullifierSecret]);
  const nullifier  = await poseidon([nullifierSecret]);

  return { secret, nullifierSecret, commitment, nullifier };
}

// ── ZK Proof generation ───────────────────────────────────────────────────────

/**
 * Check whether real circuit artifacts exist.
 */
function circuitArtifactsExist() {
  return fs.existsSync(WASM_PATH) && fs.existsSync(ZKEY_PATH);
}

/**
 * Generate a real Groth16 ZK proof using snarkjs.
 *
 * @param {object} voter        Voter identity (from createVoter())
 * @param {number} voteChoice   Candidate index (0-based)
 * @returns {object}            { proof, publicSignals, solidityProof }
 */
async function generateVoteProofReal(voter, voteChoice) {
  const { secret, nullifierSecret, commitment, nullifier } = voter;

  const input = {
    // Private
    secret:          secret.toString(),
    nullifierSecret: nullifierSecret.toString(),
    // Public
    commitment:      commitment.toString(),
    nullifier:       nullifier.toString(),
    voteChoice:      voteChoice.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  );

  const solidityProof = formatProofForSolidity(proof, publicSignals);
  return { proof, publicSignals, solidityProof };
}

/**
 * Generate a MOCK proof for testing when circuit artifacts don't exist yet.
 *
 * ⚠️  This mock bypasses cryptographic verification.
 *     It is ONLY for development/testing the contract logic.
 *     The ZKVoting contract in test mode can be replaced with a
 *     MockZKVoting that skips proof verification.
 */
async function generateVoteProofMock(voter, voteChoice) {
  const { commitment, nullifier } = voter;

  // Fake but field-valid proof points
  const FIELD_MOD = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
  );
  const fakePoint = (FIELD_MOD - 1n).toString();

  const proof = {
    pi_a: [fakePoint, fakePoint, "1"],
    pi_b: [[fakePoint, fakePoint], [fakePoint, fakePoint], ["1", "0"]],
    pi_c: [fakePoint, fakePoint, "1"],
    protocol: "groth16",
  };

  const publicSignals = [
    commitment.toString(),
    nullifier.toString(),
    voteChoice.toString(),
    "1", // validVote output
  ];

  const solidityProof = formatProofForSolidity(proof, publicSignals);
  return { proof, publicSignals, solidityProof };
}

/**
 * Main proof generation entry point.
 * Uses real proofs if artifacts exist, mock otherwise.
 */
async function generateVoteProof(voter, voteChoice) {
  if (circuitArtifactsExist()) {
    console.log("  → Generating real Groth16 ZK proof...");
    return generateVoteProofReal(voter, voteChoice);
  } else {
    console.log("  → Circuit artifacts not found. Using mock proof (run setup_circuit.sh for real proofs).");
    return generateVoteProofMock(voter, voteChoice);
  }
}

// ── Solidity calldata formatting ──────────────────────────────────────────────

/**
 * Format snarkjs proof output into the arrays expected by the Solidity verifier:
 *   pA  : uint256[2]
 *   pB  : uint256[2][2]
 *   pC  : uint256[2]
 *   pubSignals : uint256[4]
 */
function formatProofForSolidity(proof, publicSignals) {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: snarkjs uses reversed order
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: publicSignals.map((s) => s.toString()),
  };
}

/**
 * Verify a proof off-chain using the verification key JSON.
 * Useful for quick checks before submitting on-chain.
 */
async function verifyProofOffChain(proof, publicSignals) {
  const vkeyPath = path.join(ARTIFACTS_DIR, "verification_key.json");
  if (!fs.existsSync(vkeyPath)) {
    console.warn("  verification_key.json not found — skipping off-chain verify");
    return true;
  }
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  createVoter,
  generateVoteProof,
  generateVoteProofReal,
  generateVoteProofMock,
  verifyProofOffChain,
  formatProofForSolidity,
  poseidon,
  circuitArtifactsExist,
};
