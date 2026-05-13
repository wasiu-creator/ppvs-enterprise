#!/bin/sh

echo ""
echo "======================================================"
echo "  PPVS — Privacy-Preserving Voting System"
echo "  Nexus Global · Enterprise Edition"
echo "======================================================"
echo ""
echo "► [1/3] Starting local blockchain node (Hardhat)..."
npx hardhat node --hostname 0.0.0.0 &

echo "► [2/3] Waiting for node to initialise (8 seconds)..."
sleep 8

echo "► [3/3] Deploying survey contract and launching web server..."
exec npx hardhat run scripts/serve.js --network localhost
