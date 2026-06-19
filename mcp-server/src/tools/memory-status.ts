/**
 * memory_status tool — comprehensive memory system health report.
 */
import { z } from "zod";
import { queryAll, queryOne } from "../db/sqlite.js";
import { countChunks, getDbSize } from "../db/lancedb.js";
import { getModelInfo } from "../embeddings/model.js";
import { checkCacheAnchor } from "../utils/cache-utils.js";
import { estimateTokens } from "../utils/token-counter.js";
import { config } from "../config.js";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const memoryStatusSchema = {
  name: "memory_status",
  description:
    "Report memory system health: database sizes, active memory count, strength distribution, " +
    "token budget status, cache anchor integrity, and recent activity.",
  inputSchema: {},
};

export async function memoryStatusHandler(): Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  // Collect all stats
  const dailyCount = countByType("daily");
  const decisionCount = countByType("decision");
  const mocCount = countByType("moc");
  const knowledgeCount = countByType("knowledge");
  const totalNodes = dailyCount + decisionCount + mocCount + knowledgeCount;

  const entityCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM entities")?.cnt || 0;
  const relationshipCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM relationships")?.cnt || 0;
  const wikilinkCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM wikilinks")?.cnt || 0;
  const conversationCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM conversation_turns")?.cnt || 0;
  const gapCount = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM knowledge_gaps")?.cnt || 0;

  // Strength distribution
  const strengthDist = queryAll<{ bucket: string; cnt: number }>(`
    SELECT
      CASE
        WHEN strength > 0.7 THEN 'strong'
        WHEN strength > 0.3 THEN 'moderate'
        WHEN strength > 0.1 THEN 'weak'
        ELSE 'archived'
      END as bucket,
      COUNT(*) as cnt
    FROM memory_nodes
    WHERE file_type != 'template'
    GROUP BY bucket
  `);

  const strongCount = strengthDist.find(r => r.bucket === "strong")?.cnt || 0;
  const moderateCount = strengthDist.find(r => r.bucket === "moderate")?.cnt || 0;
  const weakCount = strengthDist.find(r => r.bucket === "weak")?.cnt || 0;
  const archivedCount = strengthDist.find(r => r.bucket === "archived")?.cnt || 0;

  // Token budget
  const indexTokens = getIndexTokens();
  const tokenBudgetOk = indexTokens <= config.indexTokenBudget;

  // Vector DB stats
  const vectorChunks = await countChunks();
  const vectorDbSize = await getDbSize();

  // SQLite size
  const sqliteSize = getSqliteSize();

  // Cache anchor
  const cacheResult = checkCacheAnchor();

  // Embedding model
  const modelInfo = getModelInfo();

  // Recent activity
  const lastIngest = queryOne<{ value: string }>(
    "SELECT value FROM index_metadata WHERE key = 'last_full_ingest'"
  )?.value || "never";

  const totalIngests = queryOne<{ value: string }>(
    "SELECT value FROM index_metadata WHERE key = 'total_ingests'"
  )?.value || "0";

  // Top entities
  const topEntities = queryAll<{ name: string; type: string; strength: number }>(
    "SELECT name, type, strength FROM entities ORDER BY strength DESC LIMIT 5"
  );

  const lines: string[] = [
    "# 🧠 Memory System Status",
    "",
    "## Index",
    `| Metric | Value | Status |`,
    `|--------|-------|--------|`,
    `| memory-index tokens | ~${indexTokens} / ${config.indexTokenBudget} | ${tokenBudgetOk ? "🟢" : "🔴"} |`,
    `| Cache anchor | ${config.cacheAnchor} | ${cacheResult.valid ? "🟢" : "🔴"} |`,
    "",
    "## Memory Nodes",
    `| Type | Count |`,
    `|------|-------|`,
    `| Daily notes | ${dailyCount} |`,
    `| Decisions | ${decisionCount} |`,
    `| MOCs | ${mocCount} |`,
    `| Knowledge files | ${knowledgeCount} |`,
    `| **Total** | **${totalNodes}** |`,
    "",
    "## Strength Distribution",
    `| Range | Count |`,
    `|-------|-------|`,
    `| Strong (>0.7) | ${strongCount} |`,
    `| Moderate (0.3-0.7) | ${moderateCount} |`,
    `| Weak (0.1-0.3) | ${weakCount} |`,
    `| Archived (<0.1) | ${archivedCount} |`,
    "",
    "## Knowledge Graph",
    `| Component | Count |`,
    `|-----------|-------|`,
    `| Entities | ${entityCount} |`,
    `| Relationships | ${relationshipCount} |`,
    `| Wikilinks | ${wikilinkCount} |`,
    `| Conversation turns | ${conversationCount} |`,
    `| Knowledge gaps | ${gapCount} |`,
    "",
    "## Vector Database",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total chunks | ${vectorChunks} |`,
    `| Est. size | ${(vectorDbSize / 1024 / 1024).toFixed(1)} MB |`,
    `| SQLite size | ${(sqliteSize / 1024).toFixed(0)} KB |`,
    `| Embedding model | ${modelInfo.name} |`,
    `| Model loaded | ${modelInfo.loaded ? "✅" : "❌"} |`,
    `| Dimensions | ${modelInfo.dimensions} |`,
    "",
    "## Recent Activity",
    `| Event | When |`,
    `|-------|------|`,
    `| Last ingest | ${lastIngest} |`,
    `| Total ingests | ${totalIngests} |`,
  ];

  if (topEntities.length > 0) {
    lines.push("", "## Top Entities");
    for (const e of topEntities) {
      lines.push(`- **${e.name}** (${e.type}, strength: ${e.strength.toFixed(2)})`);
    }
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

function countByType(type: string): number {
  return queryOne<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM memory_nodes WHERE file_type = ?",
    [type]
  )?.cnt || 0;
}

function getIndexTokens(): number {
  try {
    const indexPath = join(config.primaryVault, config.memoryIndexFile);
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath, "utf-8");
      return estimateTokens(content);
    }
  } catch {
    // ignore
  }
  return 0;
}

function getSqliteSize(): number {
  try {
    return statSync(config.sqlitePath()).size;
  } catch {
    return 0;
  }
}
