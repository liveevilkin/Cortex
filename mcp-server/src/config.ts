/**
 * Central configuration for the MCP memory server.
 * All paths and thresholds are overridable via environment variables.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const config = {
  // Memory vault paths
  primaryVault: process.env.CLAUDE_CODE_MEMORY_VAULT || "D:/ObsidianNote/Claude-Code-Memory",
  additionalVaults: (process.env.MCP_MEMORY_ADDITIONAL_VAULTS || "D:/ObsidianNote/学习计划")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean),

  // Database paths
  dbDir: process.env.MCP_MEMORY_DB_DIR || join(import.meta.dirname, "..", "data"),
  sqlitePath(): string {
    return join(this.dbDir, "memory-graph.db");
  },
  lancedbPath(): string {
    return join(this.dbDir, "lancedb");
  },

  // Embedding model
  embeddingModel: process.env.MCP_MEMORY_MODEL || "Xenova/all-MiniLM-L6-v2",
  embeddingDimensions: 384,  // all-MiniLM-L6-v2 default; auto-detected on first embed call
  embeddingBatchSize: parseInt(process.env.MCP_MEMORY_BATCH_SIZE || "32", 10),

  // Ebbinghaus decay parameters (match existing bash system)
  initialStrength: 1.0,
  halfLifeDays: parseInt(process.env.MCP_MEMORY_HALF_LIFE || "14", 10),
  archiveThreshold: parseFloat(process.env.MCP_MEMORY_ARCHIVE_THRESHOLD || "0.2"),
  deleteThreshold: parseFloat(process.env.MCP_MEMORY_DELETE_THRESHOLD || "0.1"),
  reinforceBonus: 0.15,

  // Chunking
  maxChunkTokens: parseInt(process.env.MCP_MEMORY_MAX_CHUNK_TOKENS || "500", 10),
  minChunkTokens: parseInt(process.env.MCP_MEMORY_MIN_CHUNK_TOKENS || "50", 10),
  chunkOverlapTokens: 50,

  // Search
  defaultSearchResults: 10,
  maxSearchResults: 50,
  vectorWeight: 0.35,
  keywordWeight: 0.25,
  entityOverlapWeight: 0.15,
  recencyWeight: 0.10,
  strengthWeight: 0.10,
  graphProximityWeight: 0.05,

  // Token budget (match existing system)
  indexTokenBudget: 1000,
  startupTokenBudget: 10000,
  recentDaysBudget: 8000,

  // Memory index file (within primary vault)
  memoryIndexFile: "memory-index.md",

  // Cache anchor (must match existing)
  cacheAnchor: "memory-index-v1",

  // Logging
  logLevel: process.env.MCP_MEMORY_LOG_LEVEL || "info",
};

export type Config = typeof config;
