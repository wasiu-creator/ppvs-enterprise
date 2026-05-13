/**
 * voting.test.js — ZK Voting System Test Suite
 * Uses native ethers patterns (no chai-matchers plugin required).
 */
const { expect } = require("chai");
const { ethers }  = require("hardhat");
const zkHelpers   = require("../scripts/zkHelpers");

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPubSignals(voter, voteChoice) {
  return [
    voter.commitment.toString(),
    voter.nullifier.toString(),
    voteChoice.toString(),
    "1",
  ];
}

function dummyProof() {
  const MAX =
    "21888242871839275222246405745257275088548364400416034343698204186575808495616";
  return { pA: [MAX, MAX], pB: [[MAX, MAX], [MAX, MAX]], pC: [MAX, MAX] };
}

/** Assert a tx reverts with optional message substring */
async function assertReverts(promise, msgSubstring) {
  try {
    await promise;
    throw new Error("Expected revert but tx succeeded");
  } catch (e) {
    if (e.message === "Expected revert but tx succeeded") throw e;
    if (msgSubstring) {
      const msg = e.message + (e.reason || "");
      if (!msg.includes(msgSubstring)) {
        throw new Error(`Expected revert with "${msgSubstring}" but got: ${e.message}`);
      }
    }
  }
}

/** Check that a tx emitted an event with given args */
async function assertEmits(tx, contract, eventName, ...args) {
  const receipt = await tx.wait();
  const iface = contract.interface;
  const found = receipt.logs.some(log => {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name !== eventName) return false;
      for (let i = 0; i < args.length; i++) {
        if (parsed.args[i].toString() !== args[i].toString()) return false;
      }
      return true;
    } catch { return false; }
  });
  if (!found) throw new Error(`Event ${eventName} not found in tx receipt`);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("ZK Voting System", function () {
  this.timeout(60000);

  let voting;
  let admin, voter1Signer, voter2Signer, voter3Signer, attacker;
  let voter1, voter2, voter3;

  const ELECTION_NAME   = "Test Election 2026";
  const NUM_CANDIDATES  = 3;

  before(async function () {
    [admin, voter1Signer, voter2Signer, voter3Signer, attacker] =
      await ethers.getSigners();

    console.log("\n  Creating voter identities (off-chain)...");
    voter1 = await zkHelpers.createVoter();
    voter2 = await zkHelpers.createVoter();
    voter3 = await zkHelpers.createVoter();

    console.log(`  voter1 commitment: ${voter1.commitment.toString().slice(0, 20)}...`);
    console.log(`  voter2 commitment: ${voter2.commitment.toString().slice(0, 20)}...`);
    console.log(`  voter3 commitment: ${voter3.commitment.toString().slice(0, 20)}...`);
  });

  beforeEach(async function () {
    const Factory = await ethers.getContractFactory("MockZKVoting");
    voting = await Factory.deploy(ELECTION_NAME, NUM_CANDIDATES);
    await voting.waitForDeployment();
  });

  // ── 1. Deployment ──────────────────────────────────────────────────────────

  describe("1. Deployment", function () {
    it("should set correct election name", async function () {
      expect(await voting.electionName()).to.equal(ELECTION_NAME);
    });

    it("should set correct number of candidates", async function () {
      expect(Number(await voting.numCandidates())).to.equal(NUM_CANDIDATES);
    });

    it("should set deployer as admin", async function () {
      expect(await voting.admin()).to.equal(admin.address);
    });

    it("should start with voting closed", async function () {
      expect(await voting.votingOpen()).to.equal(false);
    });

    it("should start with zero total votes", async function () {
      expect(Number(await voting.totalVotes())).to.equal(0);
    });

    it("should reject deployment with < 2 candidates", async function () {
      const Factory = await ethers.getContractFactory("MockZKVoting");
      await assertReverts(Factory.deploy("Bad Election", 1));
    });
  });

  // ── 2. Voter Registration ──────────────────────────────────────────────────

  describe("2. Voter Registration", function () {
    it("should register a voter commitment", async function () {
      await voting.registerVoter(voter1.commitment);
      expect(await voting.isRegistered(voter1.commitment)).to.be.true;
    });

    it("should emit VoterRegistered event", async function () {
      const tx = await voting.registerVoter(voter1.commitment);
      await assertEmits(tx, voting, "VoterRegistered", voter1.commitment);
    });

    it("should reject duplicate commitment registration", async function () {
      await voting.registerVoter(voter1.commitment);
      await assertReverts(voting.registerVoter(voter1.commitment), "already registered");
    });

    it("should allow batch registration", async function () {
      await voting.registerVotersBatch([
        voter1.commitment, voter2.commitment, voter3.commitment,
      ]);
      expect(await voting.isRegistered(voter1.commitment)).to.be.true;
      expect(await voting.isRegistered(voter2.commitment)).to.be.true;
      expect(await voting.isRegistered(voter3.commitment)).to.be.true;
    });

    it("should block batch with duplicate commitments", async function () {
      await assertReverts(
        voting.registerVotersBatch([voter1.commitment, voter1.commitment]),
        "duplicate commitment"
      );
    });

    it("should NOT allow non-admin to register voters", async function () {
      await assertReverts(
        voting.connect(voter1Signer).registerVoter(voter1.commitment),
        "not admin"
      );
    });
  });

  // ── 3. Election Lifecycle ──────────────────────────────────────────────────

  describe("3. Election Lifecycle", function () {
    it("should allow admin to start voting", async function () {
      const tx = await voting.startVoting();
      await assertEmits(tx, voting, "VotingStarted");
      expect(await voting.votingOpen()).to.be.true;
    });

    it("should allow admin to end voting", async function () {
      await voting.startVoting();
      const tx = await voting.endVoting();
      await assertEmits(tx, voting, "VotingEnded");
      expect(await voting.votingOpen()).to.be.false;
    });

    it("should reject double-start", async function () {
      await voting.startVoting();
      await assertReverts(voting.startVoting(), "already open");
    });

    it("should reject end when not open", async function () {
      await assertReverts(voting.endVoting(), "not open");
    });

    it("should NOT allow non-admin to start/end voting", async function () {
      await assertReverts(voting.connect(attacker).startVoting(), "not admin");
    });
  });

  // ── 4. Valid Vote Casting ──────────────────────────────────────────────────

  describe("4. Casting Valid Votes", function () {
    beforeEach(async function () {
      await voting.registerVoter(voter1.commitment);
      await voting.registerVoter(voter2.commitment);
      await voting.registerVoter(voter3.commitment);
      await voting.startVoting();
    });

    it("should accept a valid vote for candidate 0", async function () {
      const { pA, pB, pC } = dummyProof();
      const tx = await voting.connect(voter1Signer).castVote(
        pA, pB, pC, buildPubSignals(voter1, 0)
      );
      await assertEmits(tx, voting, "VoteCast", voter1.nullifier, 0);
      expect(Number(await voting.voteCounts(0))).to.equal(1);
      expect(Number(await voting.totalVotes())).to.equal(1);
    });

    it("should accept valid votes for all candidates", async function () {
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 0));
      await voting.castVote(pA, pB, pC, buildPubSignals(voter2, 1));
      await voting.castVote(pA, pB, pC, buildPubSignals(voter3, 2));
      expect(Number(await voting.voteCounts(0))).to.equal(1);
      expect(Number(await voting.voteCounts(1))).to.equal(1);
      expect(Number(await voting.voteCounts(2))).to.equal(1);
      expect(Number(await voting.totalVotes())).to.equal(3);
    });

    it("should mark nullifier as used after voting", async function () {
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 0));
      expect(await voting.isNullifierUsed(voter1.nullifier)).to.be.true;
    });

    it("should return correct tally via getResults()", async function () {
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 1));
      await voting.castVote(pA, pB, pC, buildPubSignals(voter2, 1));
      await voting.castVote(pA, pB, pC, buildPubSignals(voter3, 2));
      const results = await voting.getResults();
      expect(Number(results[0])).to.equal(0);
      expect(Number(results[1])).to.equal(2);
      expect(Number(results[2])).to.equal(1);
    });
  });

  // ── 5. Double-Vote Prevention ──────────────────────────────────────────────

  describe("5. Double-Vote Prevention (ZKP Nullifier)", function () {
    beforeEach(async function () {
      await voting.registerVoter(voter1.commitment);
      await voting.startVoting();
    });

    it("should reject a second vote from the same voter (same nullifier)", async function () {
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 0));
      await assertReverts(
        voting.castVote(pA, pB, pC, buildPubSignals(voter1, 1)),
        "double-vote detected"
      );
    });

    it("nullifier uniqueness — same voter cannot vote twice under any candidate", async function () {
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 0));
      // All subsequent votes with same nullifier must fail
      for (let c = 0; c < NUM_CANDIDATES; c++) {
        await assertReverts(
          voting.castVote(pA, pB, pC, buildPubSignals(voter1, c)),
          "double-vote detected"
        );
      }
    });
  });

  // ── 6. Invalid Vote Rejection ──────────────────────────────────────────────

  describe("6. Invalid Vote Rejection", function () {
    beforeEach(async function () {
      await voting.registerVoter(voter1.commitment);
      await voting.startVoting();
    });

    it("should reject vote for out-of-range candidate", async function () {
      const { pA, pB, pC } = dummyProof();
      await assertReverts(
        voting.castVote(pA, pB, pC,
          [voter1.commitment.toString(), voter1.nullifier.toString(), "99", "1"]),
        "invalid candidate"
      );
    });

    it("should reject vote with validVote != 1", async function () {
      const { pA, pB, pC } = dummyProof();
      await assertReverts(
        voting.castVote(pA, pB, pC,
          [voter1.commitment.toString(), voter1.nullifier.toString(), "0", "0"]),
        "invalid proof output"
      );
    });

    it("should reject vote from unregistered commitment", async function () {
      const { pA, pB, pC } = dummyProof();
      await assertReverts(
        voting.castVote(pA, pB, pC, buildPubSignals(voter2, 0)),
        "commitment not registered"
      );
    });

    it("should reject vote when polls are closed", async function () {
      await voting.endVoting();
      const { pA, pB, pC } = dummyProof();
      await assertReverts(
        voting.castVote(pA, pB, pC, buildPubSignals(voter1, 0)),
        "voting is not open"
      );
    });

    it("should reject vote before polls open", async function () {
      const Factory = await ethers.getContractFactory("MockZKVoting");
      const fresh = await Factory.deploy("Fresh", 3);
      await fresh.registerVoter(voter1.commitment);
      const { pA, pB, pC } = dummyProof();
      await assertReverts(
        fresh.castVote(pA, pB, pC, buildPubSignals(voter1, 0)),
        "voting is not open"
      );
    });
  });

  // ── 7. Privacy Properties ─────────────────────────────────────────────────

  describe("7. Privacy Properties", function () {
    it("nullifier should NOT be equal to the commitment", async function () {
      expect(voter1.nullifier.toString()).to.not.equal(voter1.commitment.toString());
    });

    it("two different voters should have different nullifiers", async function () {
      expect(voter1.nullifier.toString()).to.not.equal(voter2.nullifier.toString());
    });

    it("nullifier does not expose the secret", async function () {
      expect(voter1.nullifier.toString()).to.not.equal(voter1.secret.toString());
      expect(voter1.nullifier.toString()).to.not.equal(voter1.nullifierSecret.toString());
    });

    it("commitment does not expose either secret", async function () {
      expect(voter1.commitment.toString()).to.not.equal(voter1.secret.toString());
      expect(voter1.commitment.toString()).to.not.equal(voter1.nullifierSecret.toString());
    });

    it("vote counts visible but voter identity is not linkable on-chain", async function () {
      await voting.registerVoter(voter1.commitment);
      await voting.registerVoter(voter2.commitment);
      await voting.startVoting();
      const { pA, pB, pC } = dummyProof();
      await voting.castVote(pA, pB, pC, buildPubSignals(voter1, 2));
      await voting.castVote(pA, pB, pC, buildPubSignals(voter2, 2));
      const results = await voting.getResults();
      expect(Number(results[2])).to.equal(2);
      // Nullifiers are stored but no mapping to voter address exists on-chain
      expect(await voting.isNullifierUsed(voter1.nullifier)).to.be.true;
      expect(await voting.isNullifierUsed(voter2.nullifier)).to.be.true;
    });
  });

  // ── 8. Full End-to-End Scenario ───────────────────────────────────────────

  describe("8. Full End-to-End Scenario", function () {
    it("complete election lifecycle with 5 voters", async function () {
      const voters = await Promise.all([
        zkHelpers.createVoter(), zkHelpers.createVoter(), zkHelpers.createVoter(),
        zkHelpers.createVoter(), zkHelpers.createVoter(),
      ]);

      // Phase 1: Registration
      await voting.registerVotersBatch(voters.map(v => v.commitment));

      // Phase 2: Start election
      await voting.startVoting();
      expect(await voting.votingOpen()).to.equal(true);

      // Phase 3: Each voter casts a private vote
      const { pA, pB, pC } = dummyProof();
      const choices = [0, 1, 1, 2, 0];
      for (let i = 0; i < voters.length; i++) {
        await voting.castVote(pA, pB, pC, buildPubSignals(voters[i], choices[i]));
      }

      // Phase 4: End election
      await voting.endVoting();
      expect(await voting.votingOpen()).to.equal(false);

      // Phase 5: Verify results
      const results = await voting.getResults();
      expect(Number(results[0])).to.equal(2);
      expect(Number(results[1])).to.equal(2);
      expect(Number(results[2])).to.equal(1);
      expect(Number(await voting.totalVotes())).to.equal(5);

      console.log("\n  📊 Election Results:");
      console.log(`     Candidate 0: ${results[0]} votes`);
      console.log(`     Candidate 1: ${results[1]} votes`);
      console.log(`     Candidate 2: ${results[2]} votes`);
      console.log(`     Total votes: ${await voting.totalVotes()}`);
    });
  });
});
