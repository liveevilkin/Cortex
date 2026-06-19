/**
 * Main ingest pipeline — scans the Obsidian vault, parses, chunks,
 * embeds, and stores into SQLite + LanceDB.
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync } from "node:fs";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { estimateTokens } from "../utils/token-counter.js";
import { getDb, queryOne, execute, saveDatabase } from "../db/sqlite.js";
import { addChunks, deleteChunksForPath, type NoteChunkRow } from "../db/lancedb.js";
import { embedTexts, getDetectedDimensions } from "../embeddings/model.js";
import {
  parseFrontmatter,
  extractDate,
  determineFileType,
  extractTitle,
} from "./frontmatter.js";
import { chunkMarkdown } from "./chunker.js";
import {
  extractEntities,
  extractEntitiesFromFrontmatter,
} from "./entity-extractor.js";
import {
  upsertEntity,
  detectCoOccurrences,
  linkEntityToNode,
} from "../graph/knowledge-graph.js";
import { parseWikilinks, resolveWikilinkPath, buildPathSet } from "./wikilink-parser.js";

export interface IngestResult {
  filesScanned: number;
  filesIndexed: number;
  filesSkipped: number;
  chunksCreated: number;
  entitiesExtracted: number;
  relationshipsFound: number;
  wikilinksParsed: number;
  durationMs: number;
  errors: Array<{ path: string; error: string }>;
}

/**
 * Recursively find all .md files in a directory.
 */
function findMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
        results.push(...findMdFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    logger.error(`Error reading directory ${dir}: ${err}`);
  }

  return results;
}

/**
 * Main ingest function.
 * Scans vault directories for new/modified files and indexes them.
 */
export async function runIngest(options: {
  paths?: string[];
  force?: boolean;
  vaults?: string[];
  dryRun?: boolean;
}): Promise<IngestResult> {
  const startTime = Date.now();
  const result: IngestResult = {
    filesScanned: 0,
    filesIndexed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    entitiesExtracted: 0,
    relationshipsFound: 0,
    wikilinksParsed: 0,
    durationMs: 0,
    errors: [],
  };

  // Collect files to index
  const vaults = (options.vaults && options.vaults.length > 0)
    ? options.vaults
    : [config.primaryVault, ...config.additionalVaults];
  let filesToProcess: string[] = [];

  if (options.paths && options.paths.length > 0) {
    // Process specific paths
    for (const p of options.paths) {
      for (const vault of vaults) {
        const fullPath = join(vault, p);
        if (existsSync(fullPath)) {
          filesToProcess.push(fullPath);
        }
      }
    }
  } else {
    // Delta scan: find all .md files
    for (const vault of vaults) {
      const files = findMdFiles(vault);
      filesToProcess.push(...files);
    }
  }

  result.filesScanned = filesToProcess.length;

  if (options.dryRun) {
    result.durationMs = Date.now() - startTime;
    logger.info(`[DRY RUN] Would index ${filesToProcess.length} files`);
    return result;
  }

  if (filesToProcess.length === 0) {
    logger.info("No files to index");
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // Get existing memory nodes for delta comparison
  const db = getDb();
  const existingNodes = new Map<string, { file_mtime: string }>();
  try {
    const stmt = db.prepare("SELECT vault_path, file_mtime FROM memory_nodes");
    while (stmt.step()) {
      const row = stmt.getAsObject() as { vault_path: string; file_mtime: string };
      existingNodes.set(row.vault_path, { file_mtime: row.file_mtime });
    }
    stmt.free();
  } catch {
    // Table might not exist yet
  }

  // Build set of all known paths for wikilink resolution (used in Phase 2+)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _allPaths = new Set(filesToProcess.map(file => {
    for (const vault of vaults) {
      const v = vault.replace(/\\/g, "/");
      const fp = file.replace(/\\/g, "/");
      if (fp.startsWith(v)) {
        return relative(v, fp).replace(/\\/g, "/");
      }
    }
    return file.replace(/\\/g, "/");
  }));

  // Filter by delta
  const toIndex: Array<{ fullPath: string; vaultPath: string; vault: string }> = [];

  for (const fullPath of filesToProcess) {
    // Determine which vault this belongs to
    let vaultPath = "";
    let vault = "";
    const normalizedPath = fullPath.replace(/\\/g, "/");
    for (const v of vaults) {
      const normalizedVault = v.replace(/\\/g, "/");
      if (normalizedPath.startsWith(normalizedVault)) {
        vaultPath = normalizedPath.slice(normalizedVault.length).replace(/^\//, "");
        vault = v;
        break;
      }
    }
    if (!vaultPath) continue;

    // Skip templates and the memory-index itself (handled by hook system)
    if (vaultPath.includes("/templates/") || vaultPath === config.memoryIndexFile) {
      result.filesSkipped++;
      continue;
    }

    // Delta check
    if (!options.force) {
      const existing = existingNodes.get(vaultPath);
      if (existing) {
        try {
          const currentMtime = statSync(fullPath).mtime.toISOString();
          if (currentMtime === existing.file_mtime) {
            result.filesSkipped++;
            continue;
          }
        } catch {
          // File stat failed, skip
          result.filesSkipped++;
          continue;
        }
      }
    }

    toIndex.push({ fullPath, vaultPath, vault });
  }

  // Wrap ingest in a SQLite transaction for crash safety
  db.run("BEGIN TRANSACTION");

  try {
  // Process files
  const allChunks: NoteChunkRow[] = [];

  for (const { fullPath, vaultPath, vault } of toIndex) {
    try {
      // Read file
      const content = readFileSync(fullPath, "utf-8");
      const fileStat = statSync(fullPath);

      // Parse frontmatter
      const { frontmatter, bodyStart } = parseFrontmatter(content);

      // Determine metadata
      const fileType = determineFileType(vaultPath, frontmatter);
      const date = extractDate(frontmatter, vaultPath);
      const title = extractTitle(frontmatter, vaultPath);
      const tags = frontmatter.tags?.join(",") || "";
      const summary = frontmatter.summary || "";
      const strength = frontmatter.strength ?? config.initialStrength;

      // Estimate token count
      const tokenCount = estimateTokens(content);

      // Delete old chunks for this file (re-index) — skip if LanceDB not initialized
      try { await deleteChunksForPath(vaultPath); } catch (err) { logger.warn(`Chunk delete failed for ${vaultPath}: ${err}`); }

      // Chunk the body content
      const chunks = chunkMarkdown(content, fileType, bodyStart);

      // Generate embeddings for chunks
      if (chunks.length > 0) {
        const chunkTexts = chunks.map(c => c.chunk_text);
        const embeddings = await embedTexts(chunkTexts);

        // Create LanceDB rows
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const dim = getDetectedDimensions();
          const vector = Array.from(embeddings[i] || new Float32Array(dim));

          allChunks.push({
            id: `${vaultPath}#${chunk.chunk_index}`,
            vault_path: vaultPath,
            node_id: 0, // Will be updated after memory_node insert
            chunk_index: chunk.chunk_index,
            chunk_text: chunk.chunk_text,
            heading_path: chunk.heading_path,
            entities: "[]",
            tags,
            date,
            file_type: fileType,
            token_count: chunk.token_count,
            vector,
          });
        }

        result.chunksCreated += chunks.length;
      }

      // Upsert memory node in SQLite
      const existingNode = queryOne<{ id: number }>(
        "SELECT id FROM memory_nodes WHERE vault_path = ?",
        [vaultPath]
      );

      if (existingNode) {
        execute(
          `UPDATE memory_nodes SET
            title = ?, file_type = ?, date = ?, strength = ?,
            last_reinforced = ?, summary = ?, tags = ?,
            token_count = ?, file_size_bytes = ?, file_mtime = ?,
            frontmatter_json = ?, embedding_chunk_ids = ?, last_indexed = datetime('now')
           WHERE vault_path = ?`,
          [
            title, fileType, date, strength,
            frontmatter.last_reinforced || date, summary, tags,
            tokenCount, fileStat.size, fileStat.mtime.toISOString(),
            JSON.stringify(frontmatter),
            chunks.map(c => `${vaultPath}#${c.chunk_index}`).join(","),
            vaultPath,
          ]
        );
      } else {
        execute(
          `INSERT INTO memory_nodes
            (vault_path, title, file_type, date, strength, decay_half_life,
             last_reinforced, reinforced_count, status, summary, tags,
             token_count, file_size_bytes, file_mtime, frontmatter_json,
             embedding_chunk_ids, last_indexed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            vaultPath, title, fileType, date, strength, config.halfLifeDays,
            frontmatter.last_reinforced || date,
            frontmatter.reinforced_count || 0,
            summary, tags,
            tokenCount, fileStat.size, fileStat.mtime.toISOString(),
            JSON.stringify(frontmatter),
            chunks.map(c => `${vaultPath}#${c.chunk_index}`).join(","),
          ]
        );
      }

      // ── Summary fallback (from body text) ──
      const bodyContent = content.slice(bodyStart);
      const autoSummary = summary || bodyContent.replace(/\n/g, " ").trim().slice(0, 120);

      // ── Entity extraction (Phase 2) ──
      const today = new Date().toISOString().slice(0, 10);
      const nodeId = queryOne<{ id: number }>(
        "SELECT id FROM memory_nodes WHERE vault_path = ?", [vaultPath]
      )?.id;

      if (nodeId) {
        try {
          // Extract entities from content
          const contentEntities = extractEntities(content, { minConfidence: 0.4 });
          // Extract entities from frontmatter tags/links
          const fmEntities = extractEntitiesFromFrontmatter(
            frontmatter.tags || [],
            frontmatter.links || [],
            title
          );

          // Merge and deduplicate
          const allEntities = new Map<string, typeof contentEntities[0]>();
          for (const e of [...contentEntities, ...fmEntities]) {
            const existing = allEntities.get(e.name);
            if (existing) {
              existing.mentions.push(...e.mentions);
              existing.confidence = Math.max(existing.confidence, e.confidence);
            } else {
              allEntities.set(e.name, e);
            }
          }

          // Upsert entities and link to node
          const entityIds: number[] = [];
          for (const [, entity] of allEntities) {
            const entityId = upsertEntity(entity, vaultPath, today);
            entityIds.push(entityId);
            linkEntityToNode(entityId, nodeId, entity.mentions.length || 1);
            result.entitiesExtracted++;
          }

          // Detect co-occurrence relationships (cap entities at 30 to prevent O(n²) explosion)
          const cappedIds = entityIds.slice(0, 30);
          if (cappedIds.length > 1) {
            const relCount = detectCoOccurrences(cappedIds, vaultPath, "", today);
            result.relationshipsFound += relCount;
          }

          // ── Wikilink storage (Phase 2) ──
          const wikilinks = parseWikilinks(content);
          const allPaths = buildPathSet([...toIndex.map(f => f.vaultPath)]);
          for (const wl of wikilinks) {
            const resolvedPath = resolveWikilinkPath(wl.targetPath, allPaths);
            if (resolvedPath) {
              const targetNode = queryOne<{ id: number }>(
                "SELECT id FROM memory_nodes WHERE vault_path = ?", [resolvedPath]
              );
              if (targetNode) {
                try {
                  execute(
                    `INSERT OR IGNORE INTO wikilinks (source_node_id, target_node_id, link_text, context_snippet, is_auto_generated, confidence)
                     VALUES (?, ?, ?, ?, 0, 1.0)`,
                    [nodeId, targetNode.id, wl.displayText, wl.contextSnippet]
                  );
                  result.wikilinksParsed++;
                } catch (err) {
                  logger.debug(`Wikilink insert failed (expected if duplicate): ${err}`);
                }
              }
            }
          }
        } catch (err) {
          // Entity extraction is non-critical — log and continue
          logger.warn(`Entity extraction failed for ${vaultPath}: ${err}`);
        }
      }

      // Update summary if it was auto-generated
      if (!summary && nodeId) {
        execute("UPDATE memory_nodes SET summary = ? WHERE id = ?", [autoSummary, nodeId]);
      }

      result.filesIndexed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to index ${vaultPath}: ${errorMsg}`);
      result.errors.push({ path: vaultPath, error: errorMsg });
    }
  }

  // Write all chunks to LanceDB
  if (allChunks.length > 0) {
    // Update node_ids in chunks
    for (const chunk of allChunks) {
      const node = queryOne<{ id: number }>(
        "SELECT id FROM memory_nodes WHERE vault_path = ?",
        [chunk.vault_path]
      );
      if (node) {
        chunk.node_id = node.id;
      }
    }

    try { await addChunks(allChunks); } catch (err) { logger.warn(`LanceDB write skipped: ${err}`); }
  }

  // Commit SQLite transaction
  db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    logger.error(`Ingest transaction rolled back: ${err}`);
    throw err;
  }

  // Save SQLite to disk
  saveDatabase();

  // Update metadata
  execute(
    "INSERT OR REPLACE INTO index_metadata (key, value) VALUES ('last_full_ingest', ?)",
    [new Date().toISOString()]
  );
  execute(
    "UPDATE index_metadata SET value = CAST(COALESCE(CAST(value AS INTEGER), 0) + 1 AS TEXT) WHERE key = 'total_ingests'"
  );
  execute(
    "INSERT OR REPLACE INTO index_metadata (key, value) VALUES ('embedding_model', ?)",
    [config.embeddingModel]
  );

  saveDatabase();

  result.durationMs = Date.now() - startTime;
  logger.info(
    `Ingest complete: ${result.filesIndexed} indexed, ${result.filesSkipped} skipped, ` +
    `${result.chunksCreated} chunks, ${result.errors.length} errors, ${(result.durationMs / 1000).toFixed(1)}s`
  );

  return result;
}
