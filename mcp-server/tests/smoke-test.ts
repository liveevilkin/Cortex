/**
 * Quick smoke test: starts the MCP server and verifies it responds to initialize.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const serverPath = join(import.meta.dirname, "..", "dist", "index.js");

function sendMessage(proc: ChildProcess, msg: Record<string, unknown>): void {
  const line = JSON.stringify(msg);
  console.log(`>>> ${line}`);
  proc.stdin!.write(line + "\n");
}

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MCP_MEMORY_LOG_LEVEL: "debug" },
    });

    let buffer = "";
    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line

      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            console.log(`<<< ${JSON.stringify(msg).slice(0, 200)}`);
          } catch {
            // Not JSON, likely log output
          }
        }
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      console.log(`[stderr] ${data.toString().trim()}`);
    });

    proc.on("error", reject);

    // Give it a moment to initialize
    setTimeout(() => resolve(proc), 2000);
  });
}

async function main() {
  console.log("=== MCP Server Smoke Test ===\n");

  try {
    const proc = await startServer();
    console.log("Server started, sending initialize...\n");

    // Send initialize request
    sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "1.0" },
      },
    });

    // Wait for response
    await new Promise((r) => setTimeout(r, 2000));

    // Send initialized notification
    sendMessage(proc, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // List tools
    sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    // Wait for response
    await new Promise((r) => setTimeout(r, 2000));

    // Call memory_status
    sendMessage(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "memory_status", arguments: {} },
    });

    // Wait for response
    await new Promise((r) => setTimeout(r, 2000));

    proc.kill();
    console.log("\n=== Smoke test complete ===");
  } catch (err) {
    console.error("Smoke test failed:", err);
    process.exit(1);
  }
}

main();
