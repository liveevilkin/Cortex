/**
 * MCP Server setup — registers all tools and starts the stdio transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initDatabase, closeDatabase } from "./db/sqlite.js";
import { initLanceDB } from "./db/lancedb.js";
import { config } from "./config.js";
import { logger, setLogLevel } from "./utils/logger.js";

// Tool imports
import { memorySearchHandler } from "./tools/memory-search.js";
import { memoryIngestHandler } from "./tools/memory-ingest.js";
import { memoryStatusHandler } from "./tools/memory-status.js";
import { memoryEntityExtractHandler } from "./tools/memory-entity-extract.js";
import { memoryGraphQueryHandler } from "./tools/memory-graph-query.js";
import { memoryAutoLinkHandler } from "./tools/memory-auto-link.js";
import { memoryMonitorHandler } from "./tools/memory-monitor.js";
import { memoryConflictResolveHandler } from "./tools/memory-conflict-resolve.js";
import { memoryGapAnalysisHandler } from "./tools/memory-gap-analysis.js";
import { memoryConsolidateHandler } from "./tools/memory-consolidate.js";
import { memorySessionEndHandler } from "./tools/memory-session-end.js";
import { registerContextResource } from "./resources/context-resource.js";

/**
 * Create and configure the MCP server with all tools registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "claude-code-memory",
    version: "0.1.0",
  });

  // === memory_search ===
  server.tool(
    "memory_search",
    "Search the memory vault with hybrid retrieval: keyword grep + vector semantic search, ranked by relevance. " +
    "Use this to find past decisions, related knowledge, or similar discussions. " +
    "Returns context snippets with source vault paths.",
    {
      query: z.string().describe("Natural language search query. Can be a concept, question, or keywords."),
      file_types: z.array(z.enum(["daily", "decision", "moc", "knowledge", "all"]))
        .default(["all"])
        .describe("Limit search to specific memory tiers."),
      max_results: z.number().default(config.defaultSearchResults)
        .describe("Maximum number of results to return (1-50)."),
      include_related: z.boolean().default(true)
        .describe("Include related memories found through entity connections."),
      date_from: z.string().optional()
        .describe("ISO date filter (inclusive)."),
      date_to: z.string().optional()
        .describe("ISO date filter (inclusive)."),
      min_strength: z.number().default(0.1)
        .describe("Minimum memory strength threshold (0.0-1.0)."),
    },
    memorySearchHandler
  );

  // === memory_ingest ===
  server.tool(
    "memory_ingest",
    "Scan the Obsidian memory vault for new or modified markdown files and index them into the vector database. " +
    "Run at session start or after manual vault edits to keep the search index up to date. " +
    "Uses delta scanning by default (only re-indexes changed files).",
    {
      paths: z.array(z.string()).optional()
        .describe("Specific vault-relative paths to index. If empty, runs delta scan on all vaults."),
      force: z.boolean().default(false)
        .describe("Force full re-index of all files even if unchanged."),
      vaults: z.array(z.string()).default([])
        .describe("Optional explicit vault paths. If empty, uses configured vaults from environment."),
      dry_run: z.boolean().default(false)
        .describe("Report what would be indexed without actually indexing."),
    },
    memoryIngestHandler
  );

  // === memory_status ===
  server.tool(
    "memory_status",
    "Report memory system health: database sizes, active memory count, strength distribution, " +
    "token budget status, cache anchor integrity, entity graph stats, and recent activity.",
    {},
    memoryStatusHandler
  );

  // === memory_entity_extract (Phase 2) ===
  server.tool(
    "memory_entity_extract",
    "Extract named entities (technologies, people, concepts, projects, skills, companies) from text. " +
    "Returns structured entity list with types, confidence scores, and context snippets.",
    {
      text: z.string().describe("Text to extract entities from."),
      entity_types: z.array(
        z.enum(["technology", "concept", "person", "project", "skill", "company", "all"])
      ).default(["all"]).describe("Entity types to filter by."),
      include_context: z.boolean().default(true).describe(
        "Include surrounding context snippet for each entity mention."
      ),
    },
    memoryEntityExtractHandler
  );

  // === memory_graph_query (Phase 2) ===
  server.tool(
    "memory_graph_query",
    "Query the memory knowledge graph: find entities, their relationships, connected memory notes, " +
    "and traverse the graph by relation type. Use this to explore how concepts connect across your vault.",
    {
      entity_name: z.string().describe("Entity name to look up (partial match supported)."),
      relation_type: z.enum([
        "relates_to", "contradicts", "supersedes", "depends_on",
        "mentions", "part_of", "co_occurs_with", "all"
      ]).default("all").describe("Filter by relationship type."),
      traverse_depth: z.number().default(1).describe("How many hops to traverse (1-3)."),
      min_edge_weight: z.number().default(0.1).describe("Minimum edge weight (0.0-1.0)."),
      limit: z.number().default(20).describe("Maximum relationships to return."),
    },
    memoryGraphQueryHandler
  );

  // === memory_auto_link (Phase 2) ===
  server.tool(
    "memory_auto_link",
    "Scan a memory note and suggest [[wikilinks]] to other notes that share entities/concepts. " +
    "Use this to automatically build your Obsidian knowledge graph. Dry-run by default.",
    {
      vault_path: z.string().describe("Vault-relative path of the note to analyze."),
      min_confidence: z.number().default(0.5).describe("Minimum confidence threshold (0.0-1.0)."),
      max_suggestions: z.number().default(10).describe("Maximum suggestions to return."),
      dry_run: z.boolean().default(true).describe(
        "If true, only return suggestions without modifying files."
      ),
    },
    memoryAutoLinkHandler
  );

  // === memory_monitor (Phase 3) — proactive context ===
  server.tool(
    "memory_monitor",
    "Process conversation text and return proactive memory context. " +
    "Extracts entities, finds relevant past memories, detects contradictions, " +
    "and returns a 'this reminds me of...' block for injection into the conversation.",
    {
      text: z.string().describe(
        "The latest conversation text to analyze for memory relevance."
      ),
      session_id: z.string().optional().describe(
        "Opaque session identifier to group conversation turns."
      ),
      topic: z.string().optional().describe(
        "Optional topic label for this conversation segment."
      ),
      max_memories: z.number().default(5).describe(
        "Maximum number of proactive memories to return (1-10)."
      ),
    },
    memoryMonitorHandler
  );

  // === memory_conflict_resolve (Phase 3) ===
  server.tool(
    "memory_conflict_resolve",
    "Detect contradictions between new text/claims and existing memories. " +
    "Uses entity overlap to find related memories with conflict markers.",
    {
      text: z.string().describe(
        "New text or claim to check against existing memories for contradictions."
      ),
      vault_path: z.string().optional().describe(
        "Limit check to memories linked to a specific vault path."
      ),
      severity_threshold: z.enum(["low", "medium", "high"]).default("medium").describe(
        "Minimum severity to report."
      ),
    },
    memoryConflictResolveHandler
  );

  // === memory_gap_analysis (Phase 4) ===
  server.tool(
    "memory_gap_analysis",
    "Analyze the current state of knowledge relative to defined learning goals. " +
    "Identifies topics with low coverage, missing prerequisites, and suggests learning priorities.",
    {
      goal_vault_path: z.string().optional().describe(
        "Path to a learning plan document. If omitted, analyzes all known learning goals."
      ),
      include_suggestions: z.boolean().default(true).describe(
        "Include resource suggestions for filling gaps."
      ),
    },
    memoryGapAnalysisHandler
  );

  // === memory_consolidate (Phase 4) ===
  server.tool(
    "memory_consolidate",
    "Run full memory maintenance: apply Ebbinghaus decay, identify archive/deletion candidates, " +
    "detect conflicts. Use this for the bi-weekly memory cleanup routine.",
    {
      auto_archive: z.boolean().default(false).describe(
        "Automatically archive memories with strength below threshold (0.2)."
      ),
      auto_prune_entities: z.boolean().default(false).describe(
        "Remove entities with 0 connections and strength below 0.05."
      ),
    },
    memoryConsolidateHandler
  );

  // === memory_session_end (portability) ===
  server.tool(
    "memory_session_end",
    "End a session: generate a daily note and update the memory index. " +
    "Call this at the end of each session. Replaces the Claude Code Stop hook for portability.",
    {
      summary: z.string().describe("One-line summary of what was accomplished this session."),
      findings: z.array(z.string()).optional().describe("Key discoveries or decisions made."),
      next_steps: z.array(z.string()).optional().describe("Planned next actions."),
      files_changed: z.array(z.string()).optional().describe("Paths of files modified."),
    },
    memorySessionEndHandler
  );

  // === MCP Resource: session context (replaces SessionStart hook) ===
  registerContextResource(server);

  return server;
}

/**
 * Create server using auto-loader (scans tools/ and resources/ directories).
 * Use this for production — new tools are automatically discovered.
 */
export async function createServerAuto(): Promise<McpServer> {
  const { autoLoadTools, autoLoadResources } = await import("./registry/auto-loader.js");

  const server = new McpServer({
    name: "cortex-mcp",
    version: "0.1.0",
  });

  const toolCount = await autoLoadTools(server);
  const resCount = await autoLoadResources(server);
  logger.info(`Auto-loaded ${toolCount} tools + ${resCount} resources`);

  return server;
}

/**
 * Initialize all subsystems and start the MCP server.
 */
export async function startServer(): Promise<void> {
  // Set log level
  setLogLevel(config.logLevel as "debug" | "info" | "warn" | "error");

  logger.info("=== Claude Code Memory MCP Server v0.1.0 ===");
  logger.info(`Primary vault: ${config.primaryVault}`);
  logger.info(`Additional vaults: ${config.additionalVaults.join(", ")}`);
  logger.info(`Embedding model: ${config.embeddingModel}`);
  logger.info(`DB directory: ${config.dbDir}`);

  // Initialize databases
  await initDatabase();
  await initLanceDB();

  // Create and start server
  const server = createServer();
  const transport = new StdioServerTransport();

  logger.info("Starting MCP server on stdio transport...");
  await server.connect(transport);

  logger.info("MCP server ready. Waiting for tool calls...");

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await server.close();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}
