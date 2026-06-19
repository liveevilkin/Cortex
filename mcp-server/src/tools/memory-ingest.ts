/**
 * memory_ingest tool — scan vault, chunk, embed, and store to indices.
 */
import { z } from "zod";
import { runIngest } from "../ingest/pipeline.js";
import { logger } from "../utils/logger.js";

export const memoryIngestSchema = {
  name: "memory_ingest",
  description:
    "Scan the Obsidian memory vault for new or modified markdown files and index them into the vector database and knowledge graph. " +
    "Run at session start or after manual vault edits to keep the search index up to date. " +
    "Uses delta scanning by default (only re-indexes changed files based on modification time).",
  inputSchema: {
    paths: z.array(z.string()).optional().describe(
      "Specific vault-relative paths to index. If empty, runs incremental delta scan."
    ),
    force: z.boolean().default(false).describe(
      "Force full re-index of all files even if unchanged."
    ),
    vaults: z.array(z.string()).default([]).describe(
      "Which vault directory paths to scan. If empty, uses configured vaults from env vars."
    ),
    dry_run: z.boolean().default(false).describe(
      "Report what would be indexed without actually indexing."
    ),
  },
};

export async function memoryIngestHandler(args: {
  paths?: string[];
  force?: boolean;
  vaults?: string[];
  dry_run?: boolean;
}): Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  // Resolve vaults: if not specified or empty, use configured defaults
  const vaults = (args.vaults && args.vaults.length > 0) ? args.vaults : undefined;

  const result = await runIngest({
    paths: args.paths,
    force: args.force,
    vaults: vaults,
    dryRun: args.dry_run,
  });

  const dryLabel = args.dry_run ? " [DRY RUN]" : "";

  const text = [
    `# Memory Ingest${dryLabel}`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files scanned | ${result.filesScanned} |`,
    `| Files indexed | ${result.filesIndexed} |`,
    `| Files skipped | ${result.filesSkipped} |`,
    `| Chunks created | ${result.chunksCreated} |`,
    `| Entities extracted | ${result.entitiesExtracted} |`,
    `| Relationships found | ${result.relationshipsFound} |`,
    `| Wikilinks parsed | ${result.wikilinksParsed} |`,
    `| Duration | ${(result.durationMs / 1000).toFixed(1)}s |`,
    `| Errors | ${result.errors.length} |`,
    "",
  ];

  if (result.errors.length > 0) {
    text.push("## Errors");
    for (const e of result.errors) {
      text.push(`- **${e.path}**: ${e.error}`);
    }
  }

  return {
    content: [{ type: "text", text: text.join("\n") }],
  };
}
