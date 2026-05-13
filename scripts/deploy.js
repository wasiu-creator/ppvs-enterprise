/**
 * deploy.js — Deploy the ZK Voting System
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys MockZKVoting (for local dev) or ZKVoting (for production).
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost    # local
 *   npx hardhat run scripts/deploy.js --network sepolia      # testnet
 *
 * Set USE_REAL_VERIFIER=true to deploy the production ZKVoting contract.
 */

const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const useReal = process.env.USE_REAL_VERIFIER === "true";

  console.log("═══════════════════════════════════════════════════════");
  console.log("  ZK Voting System — Deployment");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:   ${network}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log(`  Contract:  ${useReal ? "ZKVoting (production)" : "MockZKVoting (development)"}`);
  console.log("───────────────────────────────────────────────────────");

  const electionName  = "Nexus Global — Workforce Preference Survey 2026";
  const numCandidates = 3;
  const contractName  = useReal ? "ZKVoting" : "MockZKVoting";

  console.log(`\n📦 Deploying ${contractName}...`);
  console.log(`   Election: "${electionName}"`);
  console.log(`   Candidates: ${numCandidates}`);

  const VotingFactory = await ethers.getContractFactory(contractName);
  const voting = await VotingFactory.deploy(electionName, numCandidates);
  await voting.waitForDeployment();

  const address = await voting.getAddress();
  console.log(`\n✅ ${contractName} deployed to: ${address}`);
  console.log(`\n   Next steps:`);
  console.log(`   1. Register voters:  voting.registerVoter(commitment)`);
  console.log(`   2. Start voting:     voting.startVoting()`);
  console.log(`   3. Cast votes:       voting.castVote(pA, pB, pC, pubSignals)`);
  console.log(`   4. End voting:       voting.endVoting()`);
  console.log(`   5. Get results:      voting.getResults()`);
  console.log("\n═══════════════════════════════════════════════════════");

  // Save deployment info
  const deploymentInfo = {
    network,
    contractName,
    address,
    electionName,
    numCandidates,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const fs = require("fs");
  fs.writeFileSync(
    "deployment.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("  deployment.json saved.");

  return address;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
