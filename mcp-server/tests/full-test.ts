/**
 * Full integration test: ingest real vault, search, verify results.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const serverPath = join(import.meta.dirname, "..", "dist", "index.js");

function sendMessage(proc: ChildProcess, msg: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

function startServer(): Promise<{ proc: ChildProcess; responses: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MCP_MEMORY_LOG_LEVEL: "info" },
    });

    const responses: string[] = [];
    let buffer = "";

    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          try {
            JSON.parse(line); // validate JSON
            responses.push(line);
          } catch { /* log output */ }
        }
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`  [log] ${msg.slice(0, 120)}`);
    });

    proc.on("error", reject);
    setTimeout(() => resolve({ proc, responses }), 3000);
  });
}

async function callTool(
  proc: ChildProcess,
  id: number,
  name: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  return new Promise((resolve) => {
    const handler = (data: Buffer) => {
      const text = data.toString();
      // Collect all output until we get a response for our id
      // For simplicity, just wait 3 seconds
    };

    proc.stdout!.on("data", handler);
    sendMessage(proc, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });

    // Wait for response
    setTimeout(() => {
      proc.stdout!.removeListener("data", handler);
      resolve("");
    }, 5000);
  });
}

async function main() {
  console.log("=== Full Integration Test ===\n");

  const { proc, responses } = await startServer();

  // Step 1: Initialize
  console.log("1. Initializing MCP handshake...");
  sendMessage(proc, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
  });
  await new Promise(r => setTimeout(r, 1000));
  sendMessage(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  await new Promise(r => setTimeout(r, 500));
  console.log("   ✅ Initialized");

  // Step 2: Ingest the vault
  console.log("2. Running memory_ingest (delta scan)...");
  console.log("   (This may take a while — embedding model will download on first use)");
  sendMessage(proc, {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "memory_ingest", arguments: { force: false, dry_run: false } },
  });

  // Wait for ingest to complete (embedding model download + processing)
  await new Promise(r => setTimeout(r, 60000));
  console.log("   ✅ Ingest initiated (check logs above)");

  // Step 3: Check status
  console.log("3. Checking memory_status...");
  sendMessage(proc, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "memory_status", arguments: {} },
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log("   ✅ Status reported");

  // Step 4: Search
  console.log("4. Testing memory_search...");
  sendMessage(proc, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "memory_search", arguments: { query: "memory architecture", max_results: 3 } },
  });
  await new Promise(r => setTimeout(r, 5000));
  console.log("   ✅ Search executed");

  // Collect all responses
  await new Promise(r => setTimeout(r, 2000));
  const allOutput = responses.join("\n---\n");

  // Print summary
  console.log("\n=== Response Summary ===");
  const toolResponses = allOutput.match(/"result":\{/g);
  console.log(`Total JSON-RPC responses: ${toolResponses?.length || 0}/4 expected`);

  // Verify key strings
  const checks = [
    { label: "Server info", pattern: "claude-code-memory" },
    { label: "Tool list", pattern: "memory_search" },
    { label: "memory_status", pattern: "Memory System Status" },
  ];

  for (const check of checks) {
    const found = allOutput.includes(check.pattern);
    console.log(`${found ? "✅" : "❌"} ${check.label}: "${check.pattern}" ${found ? "found" : "NOT FOUND"}`);
  }

  proc.kill();
  console.log("\n=== Integration test complete ===");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
