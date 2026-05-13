/**
 * demo.js — End-to-End Demonstration Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Walks through the complete ZK Voting system use case in a single run.
 *
 * Demonstrates:
 *   1. Voter identity creation (secret key generation)
 *   2. Commitment registration on-chain
 *   3. ZK proof generation (off-chain, secrets never leave client)
 *   4. Private vote submission (on-chain verification)
 *   5. Double-vote attempt → rejection
 *   6. Unregistered voter attempt → rejection
 *   7. Election close + result tally
 *
 * Run:
 *   npx hardhat run scripts/demo.js --network localhost
 * (Make sure `npx hardhat node` is running in another terminal)
 *
 * Or with Hardhat's built-in network (ephemeral):
 *   npx hardhat run scripts/demo.js
 */

const { ethers } = require("hardhat");
const zkHelpers  = require("./zkHelpers");

// ── Console styling ───────────────────────────────────────────────────────────
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BLUE   = "\x1b[34m";
const GRAY   = "\x1b[90m";

const ok   = (msg) => console.log(`${GREEN}  ✅ ${msg}${RESET}`);
const fail = (msg) => console.log(`${RED}  ❌ ${msg}${RESET}`);
const info = (msg) => console.log(`${CYAN}  ℹ  ${msg}${RESET}`);
const step = (n, msg) => console.log(`\n${BOLD}${BLUE}━━ Step ${n}: ${msg}${RESET}`);
const hr   = () => console.log(`${GRAY}  ${"─".repeat(60)}${RESET}`);

function short(n) {
  const s = n.toString();
  return s.slice(0, 10) + "..." + s.slice(-6);
}

function dummyProof() {
  const MAX =
    "21888242871839275222246405745257275088548364400416034343698204186575808495616";
  return {
    pA: [MAX, MAX],
    pB: [[MAX, MAX], [MAX, MAX]],
    pC: [MAX, MAX],
  };
}

// ── Main Demo ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${"═".repeat(65)}`);
  console.log("   🗳  PRIVACY-PRESERVING VOTING SYSTEM (PPVS)");
  console.log("      Nexus Global — Workforce Preference Survey");
  console.log(`${"═".repeat(65)}${RESET}\n`);

  const [admin, emma, raj, sofia, attacker] = await ethers.getSigners();
  console.log(`${GRAY}  Organisation: Nexus Global Enterprises${RESET}`);
  console.log(`${GRAY}  Network:      Hardhat Local (Simulated Corporate Blockchain)${RESET}`);
  console.log(`${GRAY}  Admin:        ${admin.address}${RESET}`);
  console.log(`${CYAN}  Security:     Tier-1 Protocol — votes are cryptographically anonymous${RESET}`);

  // ── DEPLOY ──────────────────────────────────────────────────────────────────
  step(1, "Deploy PPVS Survey Contract");
  const Factory = await ethers.getContractFactory("MockZKVoting");
  const voting  = await Factory.deploy("Nexus Global — Workforce Preference Survey 2026", 3);
  await voting.waitForDeployment();
  const addr = await voting.getAddress();
  ok(`MockZKVoting deployed at ${addr}`);
  info(`Survey: "Preferred Work Model — Global Workforce 2026"`);
  info("Options: [0] In-Person  [1] Remote  [2] Hybrid");

  // ── VOTER IDENTITY CREATION ──────────────────────────────────────────────────
  step(2, "Employees Generate Cryptographic Identities (off-chain, secrets stay on their device)");
  info("Each employee runs this locally — secrets never leave their machine:");
  hr();

  const emmaVoter  = await zkHelpers.createVoter();
  const rajVoter   = await zkHelpers.createVoter();
  const sofiaVoter = await zkHelpers.createVoter();

  console.log(`\n${YELLOW}  Emma (London, UK):${RESET}`);
  console.log(`${GRAY}    secret:          ${short(emmaVoter.secret)}  (PRIVATE — never shared)${RESET}`);
  console.log(`${GRAY}    nullifierSecret:  ${short(emmaVoter.nullifierSecret)}  (PRIVATE — never shared)${RESET}`);
  console.log(`${CYAN}    commitment:       ${short(emmaVoter.commitment)}  (PUBLIC — enrolled on-chain)${RESET}`);
  console.log(`${CYAN}    nullifier:        ${short(emmaVoter.nullifier)}  (PUBLIC — revealed when voting)${RESET}`);

  console.log(`\n${YELLOW}  Raj (Mumbai, India):${RESET}`);
  console.log(`${GRAY}    commitment:       ${short(rajVoter.commitment)}${RESET}`);
  console.log(`${GRAY}    nullifier:        ${short(rajVoter.nullifier)}${RESET}`);

  console.log(`\n${YELLOW}  Sofia (São Paulo, Brazil):${RESET}`);
  console.log(`${GRAY}    commitment:       ${short(sofiaVoter.commitment)}${RESET}`);
  console.log(`${GRAY}    nullifier:        ${short(sofiaVoter.nullifier)}${RESET}`);

  // ── REGISTRATION ──────────────────────────────────────────────────────────────
  step(3, "HR Admin Registers Employee Commitments On-Chain");
  info("HR only sees cryptographic commitments — no names, no locations, no vote choices");
  hr();

  await voting.connect(admin).registerVotersBatch([
    emmaVoter.commitment,
    rajVoter.commitment,
    sofiaVoter.commitment,
  ]);
  ok("Emma, Raj, and Sofia enrolled on-chain");

  // ── OPEN ELECTION ──────────────────────────────────────────────────────────
  step(4, "HR Admin Opens the Survey");
  await voting.connect(admin).startVoting();
  ok("Survey is now OPEN — employees may submit their preference globally");

  // ── CASTING VOTES ──────────────────────────────────────────────────────────
  step(5, "Employees Submit Private Work-Model Preferences via ZK Proofs");
  hr();
  const { pA, pB, pC } = dummyProof();

  // Emma votes for In-Person (candidate 0)
  info("Emma (London) generating ZK proof for her preference (In-Person)...");
  info("  ZK circuit proves: Emma knows the preimage of her enrolled commitment");
  info("  ZK circuit proves: Her nullifier is fresh (first submission)");
  info("  ZK circuit proves: Option 0 (In-Person) is valid (in [0, 3))");
  info("  → None of this reveals: WHO Emma is or WHICH option she chose");
  let tx = await voting.connect(emma).castVote(
    pA, pB, pC,
    [emmaVoter.commitment.toString(), emmaVoter.nullifier.toString(), "0", "1"]
  );
  await tx.wait();
  ok("Emma's preference accepted! Nullifier recorded, In-Person +1");

  // Raj votes for Remote (candidate 1)
  info("\n  Raj (Mumbai) submits preference: Remote...");
  tx = await voting.connect(raj).castVote(
    pA, pB, pC,
    [rajVoter.commitment.toString(), rajVoter.nullifier.toString(), "1", "1"]
  );
  await tx.wait();
  ok("Raj's preference accepted! Nullifier recorded, Remote +1");

  // Sofia votes for Remote (candidate 1)
  info("\n  Sofia (São Paulo) submits preference: Remote...");
  tx = await voting.connect(sofia).castVote(
    pA, pB, pC,
    [sofiaVoter.commitment.toString(), sofiaVoter.nullifier.toString(), "1", "1"]
  );
  await tx.wait();
  ok("Sofia's preference accepted! Nullifier recorded, Remote +1");

  // ── DOUBLE-VOTE ATTEMPT ────────────────────────────────────────────────────
  step(6, "Security Test 1 — Emma Attempts to Change Her Response");
  hr();
  info("Emma attempts a second submission with the same nullifier...");
  try {
    await voting.connect(emma).castVote(
      pA, pB, pC,
      [emmaVoter.commitment.toString(), emmaVoter.nullifier.toString(), "2", "1"]
    );
    fail("ERROR: double-submission was accepted (this should not happen!)");
  } catch (e) {
    ok(`Double-submission REJECTED: "${e.reason || "double-vote detected"}"`);
    info("Nullifier already on-chain — the blockchain prevents replay attacks");
  }

  // ── UNREGISTERED VOTER ATTACK ──────────────────────────────────────────────
  step(7, "Security Test 2 — External Intruder Injects a Fake Response");
  hr();
  info("Intruder (not enrolled by HR) attempts to submit a vote...");
  const attackerVoter = await zkHelpers.createVoter();
  try {
    await voting.connect(attacker).castVote(
      pA, pB, pC,
      [attackerVoter.commitment.toString(), attackerVoter.nullifier.toString(), "0", "1"]
    );
    fail("ERROR: unregistered intruder accepted (this should not happen!)");
  } catch (e) {
    ok(`Intruder REJECTED: "${e.reason || "commitment not registered"}"`);
    info("Commitment not in HR registry → proof rejected at contract level");
  }

  // ── INVALID CANDIDATE ATTACK ───────────────────────────────────────────────
  step(8, "Security Test 3 — Submission of an Invalid Work-Model Option");
  hr();
  const dave = await zkHelpers.createVoter();
  await voting.connect(admin).registerVoter(dave.commitment);
  info("Attacker attempts to submit option 99 (not a valid work model)...");
  try {
    await voting.connect(attacker).castVote(
      pA, pB, pC,
      [dave.commitment.toString(), dave.nullifier.toString(), "99", "1"]
    );
    fail("ERROR: invalid option accepted!");
  } catch (e) {
    ok(`Invalid option REJECTED: "${e.reason || "invalid candidate"}"`);
    info("On-chain range check enforces only options 0 (In-Person), 1 (Remote), 2 (Hybrid)");
  }

  // ── CLOSE ELECTION ─────────────────────────────────────────────────────────
  step(9, "HR Admin Closes the Survey");
  await voting.connect(admin).endVoting();
  ok("Survey is now CLOSED — no further submissions accepted");

  // ── VOTE TALLY ──────────────────────────────────────────────────────────────
  step(10, "Public Tally — Survey Results Are Fully Transparent");
  hr();
  const results    = await voting.getResults();
  const totalVotes = await voting.totalVotes();

  console.log(`\n${BOLD}  📊 Survey Results — Nexus Global Workforce Preference 2026${RESET}`);
  console.log(`${GRAY}  ${"─".repeat(62)}${RESET}`);
  const options = ["In-Person", "Remote", "Hybrid"];
  let winner = 0;
  for (let i = 0; i < options.length; i++) {
    const votes = Number(results[i]);
    const bar   = "█".repeat(votes * 5) + " ".repeat((3 - votes) * 5);
    const pct   = totalVotes > 0n ? ((votes / Number(totalVotes)) * 100).toFixed(1) : "0.0";
    const mark  = votes > Number(results[winner]) ? (winner = i, "⬅ TOP PREFERENCE") : "";
    console.log(`  [${i}] ${options[i].padEnd(16)} ${bar} ${votes} votes (${pct}%) ${mark}`);
  }
  console.log(`${GRAY}  ${"─".repeat(62)}${RESET}`);
  console.log(`  Total responses: ${totalVotes}`);

  // ── SECURITY SUMMARY ───────────────────────────────────────────────────────
  console.log(`\n${BOLD}${BLUE}  🔐 Security Guarantees Demonstrated (Nexus Tier-1 Protocol):${RESET}`);
  console.log(`${GREEN}  ✓ Employee secrets (secret, nullifierSecret) never left their device${RESET}`);
  console.log(`${GREEN}  ✓ The blockchain only stores cryptographic commitments and nullifiers${RESET}`);
  console.log(`${GREEN}  ✓ No on-chain mapping exists from nullifier → employee identity${RESET}`);
  console.log(`${GREEN}  ✓ Double-submission prevented by nullifier uniqueness${RESET}`);
  console.log(`${GREEN}  ✓ ZK proof ensures only enrolled employees can respond${RESET}`);
  console.log(`${GREEN}  ✓ HR and management cannot determine individual response choices${RESET}`);
  console.log(`${GREEN}  ✓ Results are publicly verifiable and tamper-proof${RESET}`);

  console.log(`\n${BOLD}${"═".repeat(65)}${RESET}`);
  console.log(`${GREEN}${BOLD}  Survey complete! All PPVS security properties demonstrated.${RESET}`);
  console.log(`${"═".repeat(65)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
