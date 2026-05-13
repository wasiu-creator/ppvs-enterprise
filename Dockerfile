# ── PPVS — Privacy-Preserving Voting System ──────────────────────────────────
# Global Enterprise
# Node 20 on Alpine Linux (small, fast image)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer — only rebuilds when package.json changes)
COPY package.json ./
RUN npm install

# Copy the rest of the project source
COPY . .

# Pre-compile Solidity contracts so the container starts faster
RUN npx hardhat compile

# Make the startup script executable
RUN chmod +x /app/start.sh

# ── Ports ─────────────────────────────────────────────────────────────────────
# 3000  → PPVS web frontend  (open in browser)
# 8545  → Hardhat JSON-RPC   (MetaMask / ethers.js connects here)
EXPOSE 3000 8545

CMD ["/bin/sh", "/app/start.sh"]
