#!/usr/bin/env bash
# =============================================================================
#  ZK Circuit Trusted Setup Script
#  Privacy-Preserving Voting System
# =============================================================================
#
#  This script automates the full Circom/snarkjs pipeline:
#    1. Compile vote.circom → R1CS + WASM witness generator
#    2. Powers of Tau ceremony (phase 1) — local, non-interactive
#    3. Circuit-specific setup (phase 2) — generates proving/verification keys
#    4. Export Solidity Verifier.sol
#
#  Run from the project root:
#    bash scripts/setup_circuit.sh
# =============================================================================

set -e  # Exit on any error

CIRCUITS_DIR="circuits"
ARTIFACTS_DIR="artifacts/circuits"
CONTRACTS_DIR="contracts"
PTAU_FILE="$ARTIFACTS_DIR/powersOfTau28_hez_final_12.ptau"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${BLUE}[SETUP]${NC} $1"; }
ok()   { echo -e "${GREEN}[  OK ]${NC} $1"; }
warn() { echo -e "${YELLOW}[ WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Check prerequisites ───────────────────────────────────────────────────────
log "Checking prerequisites..."

command -v node   >/dev/null 2>&1 || err "node not found. Install Node.js >= 16"
command -v npx    >/dev/null 2>&1 || err "npx not found"

# Check for circom v2 specifically (npm's 'circom' package is v1 and incompatible)
CIRCOM_OK=false
if command -v circom >/dev/null 2>&1; then
  CIRCOM_VER=$(circom --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
  CIRCOM_MAJOR=$(echo "$CIRCOM_VER" | cut -d. -f1)
  if [ "$CIRCOM_MAJOR" -ge 2 ] 2>/dev/null; then
    CIRCOM_OK=true
    ok "circom v2 found: $(circom --version 2>&1)"
  else
    warn "Found circom v1 (npm package) — this is incompatible. Need circom v2."
    # Uninstall the v1 npm package to avoid confusion
    npm uninstall -g circom 2>/dev/null || true
  fi
fi

if [ "$CIRCOM_OK" = false ]; then
  warn "circom v2 not found. Downloading pre-built binary..."
  CIRCOM_BIN="$HOME/.local/bin/circom"
  mkdir -p "$HOME/.local/bin"

  # Detect OS and pick the right binary
  OS_TYPE="$(uname -s)"
  case "$OS_TYPE" in
    MINGW*|MSYS*|CYGWIN*)
      CIRCOM_URL="https://github.com/iden3/circom/releases/latest/download/circom-windows-amd64.exe"
      CIRCOM_BIN="$HOME/.local/bin/circom.exe"
      ;;
    Darwin*)
      CIRCOM_URL="https://github.com/iden3/circom/releases/latest/download/circom-macos-amd64"
      ;;
    *)
      CIRCOM_URL="https://github.com/iden3/circom/releases/latest/download/circom-linux-amd64"
      ;;
  esac

  curl -L "$CIRCOM_URL" -o "$CIRCOM_BIN" 2>/dev/null && chmod +x "$CIRCOM_BIN" && {
    export PATH="$HOME/.local/bin:$PATH"
    ok "circom v2 installed at $CIRCOM_BIN"
    ok "Version: $(circom --version 2>&1)"
  } || {
    # Fallback: try cargo if rust is available
    if command -v cargo >/dev/null 2>&1; then
      warn "Binary download failed. Building from source via cargo (this takes a few minutes)..."
      cargo install circom && CIRCOM_OK=true || err "cargo install circom failed."
    else
      err "Could not install circom v2. Options:
  1. Download manually: https://github.com/iden3/circom/releases/latest
     Place 'circom.exe' somewhere on your PATH
  2. Install Rust then run: cargo install circom"
    fi
  }
fi

mkdir -p "$ARTIFACTS_DIR"

# ── Step 1: Compile the circuit ───────────────────────────────────────────────
log "Step 1/4 — Compiling vote.circom..."

# Resolve absolute path to node_modules (circom v2 requires absolute -l paths)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

circom "$CIRCUITS_DIR/vote.circom" \
  --r1cs \
  --wasm \
  --sym \
  --output "$ARTIFACTS_DIR" \
  -l "$PROJECT_ROOT/node_modules"

ok "Circuit compiled → R1CS + WASM witness generator created"
npx snarkjs r1cs info "$ARTIFACTS_DIR/vote.r1cs"

# ── Step 2: Powers of Tau (Phase 1) ──────────────────────────────────────────
log "Step 2/4 — Powers of Tau ceremony (Phase 1)..."

PTAU_LOCAL="$ARTIFACTS_DIR/pot12_final.ptau"

# Validate existing ptau file — delete if corrupt (snarkjs header check)
validate_ptau() {
  local f="$1"
  [ -f "$f" ] || return 1
  # snarkjs ptau files start with the magic bytes "ptau"
  local magic
  magic=$(head -c 4 "$f" 2>/dev/null | cat -v 2>/dev/null || true)
  if echo "$magic" | grep -q "ptau"; then
    return 0
  else
    warn "Existing ptau file is corrupt or invalid — deleting."
    rm -f "$f"
    return 1
  fi
}

if validate_ptau "$PTAU_LOCAL"; then
  ok "Powers of Tau already exists and is valid (skipping generation)"
  PTAU_FILE="$PTAU_LOCAL"
else
  # Try downloading from multiple mirrors
  DOWNLOAD_OK=false
  for URL in \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau"; do
    log "  Trying download: $URL"
    curl -fsSL "$URL" -o "$PTAU_LOCAL" 2>/dev/null && validate_ptau "$PTAU_LOCAL" && {
      DOWNLOAD_OK=true
      PTAU_FILE="$PTAU_LOCAL"
      ok "Powers of Tau downloaded successfully"
      break
    }
    rm -f "$PTAU_LOCAL"
  done

  if [ "$DOWNLOAD_OK" = false ]; then
    warn "All downloads failed or produced invalid file. Generating locally (development use only)..."
    POT_0="$ARTIFACTS_DIR/pot12_0000.ptau"
    POT_1="$ARTIFACTS_DIR/pot12_0001.ptau"
    rm -f "$POT_0" "$POT_1" "$PTAU_LOCAL"

    npx snarkjs powersoftau new bn128 12 "$POT_0" -v
    npx snarkjs powersoftau contribute "$POT_0" "$POT_1" \
        --name="Dev contribution" -v \
        -e="$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | head -c 64)"
    npx snarkjs powersoftau prepare phase2 "$POT_1" "$PTAU_LOCAL" -v
    rm -f "$POT_0" "$POT_1"
    PTAU_FILE="$PTAU_LOCAL"
  fi
fi

ok "Powers of Tau ready: $PTAU_FILE"

# ── Step 3: Circuit-Specific Setup (Phase 2 — Groth16) ────────────────────────
log "Step 3/4 — Generating proving and verification keys..."

# Initial zkey
npx snarkjs groth16 setup \
  "$ARTIFACTS_DIR/vote.r1cs" \
  "$PTAU_FILE" \
  "$ARTIFACTS_DIR/vote_0000.zkey"

# Contribute randomness (in production: multiple independent parties do this)
npx snarkjs zkey contribute \
  "$ARTIFACTS_DIR/vote_0000.zkey" \
  "$ARTIFACTS_DIR/vote_0001.zkey" \
  --name="ZKVoting Dev Contribution" \
  -e="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)"

# Apply beacon (simulating a random beacon for finalization)
npx snarkjs zkey beacon \
  "$ARTIFACTS_DIR/vote_0001.zkey" \
  "$ARTIFACTS_DIR/vote_final.zkey" \
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" \
  10 \
  -n="Final Beacon phase2"

# Export verification key JSON
npx snarkjs zkey export verificationkey \
  "$ARTIFACTS_DIR/vote_final.zkey" \
  "$ARTIFACTS_DIR/verification_key.json"

ok "Proving key:       $ARTIFACTS_DIR/vote_final.zkey"
ok "Verification key:  $ARTIFACTS_DIR/verification_key.json"

# ── Step 4: Export Solidity Verifier ─────────────────────────────────────────
log "Step 4/4 — Exporting Solidity verifier contract..."

npx snarkjs zkey export solidityverifier \
  "$ARTIFACTS_DIR/vote_final.zkey" \
  "$CONTRACTS_DIR/Verifier.sol"

ok "Verifier.sol exported to contracts/"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Circuit setup complete!                            ${NC}"
echo -e "${GREEN}  Next steps:                                        ${NC}"
echo -e "${GREEN}    npx hardhat compile                              ${NC}"
echo -e "${GREEN}    npx hardhat test                                 ${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
