/**
 * PPVS — Deploy + Serve
 * ──────────────────────────────────────────────────────────────
 * Deploys MockZKVoting to the local Hardhat node, then starts
 * a tiny HTTP server so you can open index.html in your browser.
 *
 * Usage (from project root, with `npx hardhat node` already running):
 *
 *   node node_modules\.bin\hardhat run scripts/serve.js --network localhost
 *
 * Then open:  http://localhost:3000
 * ──────────────────────────────────────────────────────────────
 */

const hre     = require("hardhat");
const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const { execSync } = require("child_process");

const PORT = 3000;

// ── MIME types ────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

async function main() {
  // ── Deploy MockZKVoting ──────────────────────────────────────
  console.log("\n🚀  Deploying MockZKVoting to localhost…");
  const Factory = await hre.ethers.getContractFactory("MockZKVoting");
  const contract = await Factory.deploy("Nexus Global — Workforce Preference Survey 2026", 3);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✅  Contract deployed!`);
  console.log(`    Address   : ${address}`);
  console.log(`    Survey    : "Nexus Global — Workforce Preference Survey 2026"`);
  console.log(`    Options   : [0] In-Person  [1] Remote  [2] Hybrid\n`);

  // ── Serve index.html ─────────────────────────────────────────
  const root = path.resolve(__dirname, "..");

  const server = http.createServer((req, res) => {
    // Default to index.html
    let filePath = req.url === "/" ? "/index.html" : req.url;
    // Strip query strings
    filePath = filePath.split("?")[0];
    const fullPath = path.join(root, filePath);

    // Security: stay within project root
    if (!fullPath.startsWith(root)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Not found: ${filePath}`);
        return;
      }
      const ext  = path.extname(fullPath).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("═══════════════════════════════════════════════════");
    console.log("  PPVS Frontend ready!");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  URL         : http://localhost:${PORT}`);
    console.log(`  Contract    : ${address}`);
    console.log("───────────────────────────────────────────────────");
    console.log("  In the browser:");
    console.log(`  1. Paste contract address: ${address}`);
    console.log("  2. Click Connect");
    console.log("  3. Add voters → Register → Start → Vote!");
    console.log("═══════════════════════════════════════════════════");
    console.log("\n  Press Ctrl+C to stop.\n");
  });
}

main().catch(e => { console.error(e); process.exit(1); });
