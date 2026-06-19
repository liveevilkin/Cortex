#!/usr/bin/env node
/**
 * Entry point for the Claude Code Memory MCP Server.
 * Initializes databases and starts the stdio transport.
 *
 * Usage: node dist/index.js
 *        npx tsx src/index.ts   (development)
 */
import { startServer } from "./server.js";

startServer().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
