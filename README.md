# 🗳 PPVS — Privacy-Preserving Voting System
### Global Enterprise · Zero-Knowledge Proofs

> **The corporate privacy guarantee:** employees prove they are enrolled and have not yet responded — without revealing *who they are* or *which option they chose*. Enforced by cryptography, not policy.

---

## 🐳 Beginner's Guide — Launch with Docker (Recommended)

> **No Node.js, no Hardhat, no blockchain experience required.**  
> Docker handles everything automatically.

---

### Step 0 — What you need on your machine

| Tool | Where to get it | Check it works |
|---|---|---|
| **Docker Desktop** | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | `docker --version` |
| **Git** (optional, for cloning) | [git-scm.com](https://git-scm.com/) | `git --version` |

Install Docker Desktop and make sure it is **running** (you will see the whale icon in your system tray).

---

### Step 1 — Get the project files

**Option A — Clone from GitHub (recommended)**
```bash
git clone https://github.com/lexico1807/ppvs-enterprise.git
cd ppvs-enterprise
```

**Option B — Download the ZIP**  
Click the green **Code → Download ZIP** button on GitHub, then unzip and open a terminal inside the folder.

---

### Step 2 — Build the Docker image

Open a terminal (PowerShell on Windows, Terminal on Mac/Linux) **inside the project folder** and run:

```bash
docker-compose build
```

> **What this does:** Docker downloads Node.js, installs all blockchain dependencies, and compiles the smart contracts. This takes **2–5 minutes** the first time. Subsequent builds are instant (cached).

You should see output ending with:
```
=> exporting to image
=> => writing image sha256:...
=> => naming to docker.io/library/ppvs-enterprise
```

---

### Step 3 — Start the application

```bash
docker-compose up
```

Wait for this exact line to appear in your terminal (about 10–15 seconds):

```
  PPVS Frontend ready!
  URL         : http://localhost:3000
  Contract    : 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

> **Do not close this terminal.** It is running the blockchain node and web server.

---

### Step 4 — Open the app in your browser

Navigate to:

```
http://localhost:3000
```

You will see the **PPVS Enterprise** dashboard.

---

### Step 5 — Connect the frontend to the blockchain

1. In the **"Connect to Hardhat Node"** panel at the top, you will see two fields:
   - **Contract Address** — copy the address printed in your terminal (e.g. `0x5FbDB2315678afecb367f032d93F642f64180aa3`)
   - **RPC URL** — leave as `http://127.0.0.1:8545` (already filled in)

2. Paste the contract address and click **Connect**.

3. The status bar at the top turns green: **"Connected · 20 accounts · Election: Global Ent."**

---

### Step 6 — Run your first survey

Follow the numbered panels on screen:

| Step | Panel | What to do |
|---|---|---|
| 1 | **Employee Roster** | Type employee names (e.g. `Emma — London`) and press **+ Add** |
| 2 | **Survey Control** | Click **Enrol All Employees On-Chain**, then **Open Survey** |
| 3 | **Submit Your Preference** | Select an employee, choose **In-Person / Remote / Hybrid**, click **Cast ZK Vote** |
| 4 | **Live Survey Results** | Click **Refresh Results** to see the live tally |

Try voting twice with the same employee — the system rejects it with `"double-vote detected"`.

---

### Step 7 — Stop the application

Press `Ctrl + C` in the terminal where `docker-compose up` is running, then:

```bash
docker-compose down
```

---

### Troubleshooting Docker

| Problem | Fix |
|---|---|
| `Cannot connect to Docker daemon` | Start Docker Desktop and wait for it to fully load |
| Port 3000 or 8545 already in use | Run `docker-compose down` first, or stop any other app on that port |
| Frontend says "Connection failed" | Wait 15 seconds after the terminal shows "PPVS Frontend ready!" — the node needs time |
| Browser shows blank page | Hard-refresh with `Ctrl + Shift + R` |
| Changes not reflected after editing code | Run `docker-compose build` again before `docker-compose up` |

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EMPLOYEE'S BROWSER (Client)                      │
│                                                                     │
│  secret ──────┐                                                     │
│               ├─ Poseidon(secret, nullSec) ──► commitment (public)  │
│  nullSec ─────┘                                                     │
│               └─ Poseidon(nullSec)         ──► nullifier  (public)  │
│                                                                     │
│  ZK Proof Input:   secret, nullSec, workModel  ← NEVER LEAVES HERE │
│  ZK Proof Output:  commitment, nullifier, workModel, valid          │
│                    └──────────────────── PUBLIC (on-chain) ─────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │  ZK Proof
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                DOCKER CONTAINER (Blockchain Node)                   │
│                                                                     │
│  MockZKVoting.sol (port 8545)                                       │
│  ├─ registeredCommitments[commitment] = true   ← HR enrolment       │
│  ├─ verifyProof(pA, pB, pC, pubSignals)        ← Groth16 check      │
│  ├─ usedNullifiers[nullifier] = true           ← no double vote     │
│  └─ voteCounts[option] += 1                    ← private tally      │
│                                                                     │
│  HTTP Server (port 3000)  ──►  index.html (PPVS frontend)          │
└─────────────────────────────────────────────────────────────────────┘
```

### Work Model Options

| Index | Option | Description |
|---|---|---|
| 0 | 🏢 In-Person | Office-first work model |
| 1 | 🏠 Remote | Work-from-home model |
| 2 | 🔄 Hybrid | Flexible / mixed model |

### Security Properties (Tier-1 Protocol)

| Property | How it's enforced |
|---|---|
| Employee anonymity | `commitment == Poseidon(secret, nullSec)` — hash is irreversible |
| No double responding | `nullifier = Poseidon(nullSec)` stored on-chain, checked unique |
| Valid option only | `optionIndex < 3` range check enforced on-chain |
| Identity hidden | Secrets never leave the employee's browser |
| Vote choice hidden | Choice appears in proof but is not linkable to the commitment |

---

## 🗂 Project Structure

```
ppvs-enterprise/
├── Dockerfile               ← Container definition
├── docker-compose.yml       ← One-command launcher
├── start.sh                 ← Container startup script
├── index.html               ← PPVS web frontend (single file, no build step)
├── hardhat.config.js        ← Blockchain network configuration
├── package.json
├── contracts/
│   ├── MockZKVoting.sol     ← Dev contract (skips ZK verify, instant startup)
│   ├── ZKVoting.sol         ← Production contract (full Groth16 verification)
│   └── Verifier.sol         ← Groth16 verifier (generated by snarkjs)
├── scripts/
│   ├── serve.js             ← Deploys contract + serves index.html on port 3000
│   ├── deploy.js            ← Standalone deployment script
│   ├── demo.js              ← Narrated end-to-end CLI demo
│   └── zkHelpers.js         ← Proof generation utilities
├── circuits/
│   └── vote.circom          ← ZK circuit definition (Circom DSL)
└── test/
    └── voting.test.js       ← 34 automated test cases
```

---

## ⚡ Alternative: Run Without Docker (Node.js)

If you have Node.js 18+ installed and prefer not to use Docker:

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Compile contracts
```bash
npx hardhat compile
```

### Step 3 — Start everything in one command
```bash
npx hardhat run scripts/serve.js --network localhost
```
> This requires a running Hardhat node. Start one first in a separate terminal:
> ```bash
> npx hardhat node
> ```

### Step 4 — Or run the narrated CLI demo
```bash
npx hardhat run scripts/demo.js
```

### Step 5 — Run all 34 tests
```bash
npx hardhat test
```

Expected:
```
  34 passing (1s)
```

---

## 🔐 Full ZK Mode (Real Circom Proofs)

By default, PPVS uses `MockZKVoting.sol` which skips cryptographic proof verification for faster development. To run with real Groth16 proofs:

### Prerequisites
- Git Bash or WSL (Windows Subsystem for Linux)
- Circom compiler: `cargo install circom` ([docs](https://docs.circom.io/getting-started/installation/))

### Trusted Setup

```bash
bash scripts/setup_circuit.sh
```

This compiles `vote.circom`, downloads the Powers of Tau ceremony file, runs Groth16 phase-2 setup, and exports `contracts/Verifier.sol`.

### Deploy with real verifier

```bash
# Terminal 1
npx hardhat node

# Terminal 2
USE_REAL_VERIFIER=true npx hardhat run scripts/deploy.js --network localhost
```

---

## 🧪 How the ZK Proof Works

#### Phase 1 — Employee Enrolment (before survey opens)
```
Emma (London):
  secret          = random()            # stored only on Emma's device
  nullifierSecret = random()            # stored only on Emma's device
  commitment      = Poseidon(secret, nullifierSecret)  # sent to HR
  nullifier       = Poseidon(nullifierSecret)           # revealed when voting

Emma → HR Admin: "Please enrol commitment = 0x1a2b3c..."
HR Admin → Chain: voting.registerVoter(0x1a2b3c...)
```

#### Phase 2 — Casting a Preference (survey open)
```
Emma wants to select "Remote" (option 1):

Emma's browser runs locally:
  circuit.prove({
    private: { secret, nullifierSecret },
    public:  { commitment, nullifier, optionIndex: 1 }
  })
  → Generates: (proof_A, proof_B, proof_C)

Browser → Chain: voting.castVote(proof_A, proof_B, proof_C, [commitment, nullifier, 1, 1])

Chain checks:
  ✓ verifyProof()         → cryptographically valid
  ✓ commitment registered → Emma is an enrolled employee
  ✓ nullifier not used    → Emma hasn't voted before — store it
  ✓ option 1 exists       → "Remote" is a valid work model
  → voteCounts[1] += 1
```

#### Phase 3 — Results (survey closed)
```
Anyone can call: voting.getResults()
→ [1, 2, 0]   (In-Person: 1, Remote: 2, Hybrid: 0)

Nobody can determine:
  - Which employee chose which option
  - Whether two nullifiers belong to the same person
  - HR cannot identify individual responses
```

---

## 📝 Contract Interface

```solidity
// Enrol employees (HR admin only)
function registerVoter(uint256 commitment) external;
function registerVotersBatch(uint256[] calldata commitments) external;

// Survey control (HR admin only)
function startVoting() external;
function endVoting() external;

// Cast a private preference
function castVote(
    uint256[2]    calldata pA,
    uint256[2][2] calldata pB,
    uint256[2]    calldata pC,
    uint256[4]    calldata pubSignals  // [commitment, nullifier, optionIndex, validVote]
) external;

// Read results (anyone)
function getResults() external view returns (uint256[] memory);
function isNullifierUsed(uint256 nullifier) external view returns (bool);
function isRegistered(uint256 commitment) external view returns (bool);
```

---

## 📚 Key Concepts

**Poseidon Hash** — ZK-friendly hash function used inside the Circom circuit. Unlike SHA-256, Poseidon works efficiently as arithmetic circuit constraints.

**Groth16** — The ZK proof system used. Produces small (~200 byte), fast-to-verify proofs. Requires a one-time trusted setup per circuit.

**Nullifier** — A deterministic value derived from the employee's secret. Revealing it on-chain proves the employee hasn't responded before, without revealing their identity.

**Commitment** — A cryptographic binding to the employee's secrets. Registered on-chain during enrolment. Cannot be reversed.

**Trusted Setup** — A one-time ceremony to generate proving/verification keys. In production, run by multiple independent parties for maximum security.

---

*Global Enterprises · PPVS Enterprise Edition · COSC 896 — Blockchain Systems · BSU · Spring 2026*
