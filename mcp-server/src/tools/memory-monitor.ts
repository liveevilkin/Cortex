/**
 * memory_monitor tool — the proactive core of the memory agent.
 *
 * Processes conversation text: extracts entities, retrieves relevant past memories,
 * detects potential contradictions, and returns a "proactive context" block that can
 * be injected into the conversation to say "this reminds me of your previous work on..."
 */
import { z } from "zod";
import { extractEntities } from "../ingest/entity-extractor.js";
import { queryAll, queryOne, execute, saveDatabase } from "../db/sqlite.js";
import { embedQuery } from "../embeddings/model.js";
import { searchChunks } from "../db/lancedb.js";
import { calcDecayedStrength, reinforceMemory } from "../graph/decay.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { truncateToTokens } from "../utils/token-counter.js";

export const memoryMonitorSchema = {
  name: "memory_monitor",
  description:
    "Process the latest conversation turn: extract entities, find relevant past memories, " +
    "detect contradictions, and return proactive context for injection. " +
    "Call this to get 'this reminds me of...' context from your memory vault.",
  inputSchema: {
    text: z.string().describe(
      "The latest conversation text (user message, assistant response, or summary)."
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
};

interface MemoryHit {
  vault_path: string;
  title: string;
  file_type: string;
  date: string;
  strength: number;
  summary: string;
  relevance_reason: string;
  snippet: string;
  relevance_score: number;
  shared_entities: number;
}

interface DetectedContradiction {
  existing_memory: string;
  existing_claim: string;
  new_claim: string;
  severity: "low" | "medium" | "high";
}

export async function memoryMonitorHandler(args: {
  text: string;
  session_id?: string;
  topic?: string;
  max_memories?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const text = args.text;
  const maxMemories = Math.min(args.max_memories || 5, 10);
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Extract entities from conversation text ──
  const entities = extractEntities(text, { minConfidence: 0.4, entityTypes: "all" });
  const entityNames = entities.map(e => e.name);

  // ── 2. Find relevant memories ──
  // 2a. Entity-based: memories sharing entities with the conversation
  const entityMemories = findMemoriesByEntities(entityNames, maxMemories * 2);

  // 2b. Keyword-based: search for key terms in the text
  const keywords = text.split(/[\s,，。！？]+/).filter(k => k.length > 2);
  const keywordMemories = findMemoriesByKeywords(keywords, maxMemories);

  // 2c. Vector-based: semantic search (if embeddings available)
  let vectorMemories: Map<string, { similarity: number; snippet: string }> = new Map();
  try {
    const queryVec = await embedQuery(text);
    // Only use vector if it's non-zero (embeddings available)
    if (queryVec.some(v => v !== 0)) {
      const hits = await searchChunks(Array.from(queryVec), maxMemories);
      for (const h of hits) {
        vectorMemories.set(h.row.vault_path, {
          similarity: h.score,
          snippet: h.row.chunk_text,
        });
      }
    }
  } catch { /* embeddings unavailable */ }

  // ── 3. Merge & rank ──
  const merged = mergeAndRank(entityMemories, keywordMemories, vectorMemories, entityNames);
  const topMemories = merged.slice(0, maxMemories);

  // ── 4. Detect contradictions ──
  const contradictions = detectContradictions(entityNames, text);

  // ── 5. Reinforce accessed memories ──
  for (const m of topMemories) {
    reinforceMemory(m.vault_path, config.reinforceBonus * 0.5); // half bonus for passive access
  }

  // ── 6. Log conversation turn ──
  logConversationTurn(entities, topMemories, args.session_id, args.topic);

  saveDatabase();

  // ── 7. Format response ──
  const lines: string[] = [
    `# Memory Monitor`,
    "",
  ];

  // Proactive context block
  if (topMemories.length > 0) {
    lines.push("## 💡 Proactive Context", "");
    lines.push("*The following memories are related to your current conversation:*");
    lines.push("");

    for (let i = 0; i < topMemories.length; i++) {
      const m = topMemories[i];
      const icon = m.file_type === "decision" ? "📋" : m.file_type === "daily" ? "📅" : "📄";
      lines.push(`### ${i + 1}. ${icon} ${m.title} \`${m.vault_path}\``);
      lines.push(`- **Relevance**: ${m.relevance_score.toFixed(2)} (${m.relevance_reason})`);
      lines.push(`- **Strength**: ${m.strength.toFixed(2)} | **Date**: ${m.date || "unknown"}`);
      if (m.summary) lines.push(`- **Summary**: ${m.summary}`);
      if (m.snippet) {
        lines.push("");
        lines.push("```");
        lines.push(truncateToTokens(m.snippet, 150));
        lines.push("```");
      }
      lines.push("");
    }

    lines.push("> ℹ️ Use `memory_search` for deeper investigation of any memory above.");
    lines.push("");
  } else {
    lines.push("## 💡 Proactive Context", "");
    lines.push("*No strongly relevant memories found for this conversation.*");
    lines.push("*(Try running `memory_ingest` to expand the index.)*");
    lines.push("");
  }

  // Extracted entities
  if (entities.length > 0) {
    lines.push("## 🔍 Extracted Entities");
    lines.push(`Found **${entities.length}** entities: ` +
      entities.slice(0, 8).map(e => `\`${e.name}\``).join(", ") +
      (entities.length > 8 ? ` ... (${entities.length - 8} more)` : ""));
    lines.push("");
  }

  // Contradictions
  if (contradictions.length > 0) {
    lines.push("## ⚠️ Potential Contradictions", "");
    for (const c of contradictions) {
      lines.push(`- **[${c.severity.toUpperCase()}]** \`${c.existing_memory}\`: "${c.existing_claim.slice(0, 100)}"`);
      lines.push(`  → New claim: "${c.new_claim.slice(0, 100)}"`);
    }
    lines.push("");
    lines.push("> Use `memory_conflict_resolve` to investigate further.");
    lines.push("");
  }

  // Graph update summary
  lines.push("## 📊 Session Stats", "");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Entities extracted | ${entities.length} |`);
  lines.push(`| Relevant memories found | ${topMemories.length} |`);
  lines.push(`| Contradictions detected | ${contradictions.length} |`);
  lines.push(`| Top entity | ${entities[0]?.name || "none"} |`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

// ── Helper functions ──

function findMemoriesByEntities(entityNames: string[], limit: number): MemoryHit[] {
  if (entityNames.length === 0) return [];

  const placeholders = entityNames.map(() => "?");
  const sql = `
    SELECT DISTINCT m.vault_path, m.title, m.file_type, m.date, m.strength, m.summary,
           COUNT(DISTINCT ne.entity_id) as shared_entities,
           '' as snippet, '' as relevance_reason, 0.0 as relevance_score
    FROM memory_nodes m
    JOIN node_entities ne ON m.id = ne.node_id
    JOIN entities e ON ne.entity_id = e.id
    WHERE e.name IN (${placeholders.join(",")})
      AND m.status = 'active'
    GROUP BY m.id
    ORDER BY shared_entities DESC, m.strength DESC
    LIMIT ?
  `;

  const result = queryAll<MemoryHit>(sql, [...entityNames, limit]);
  for (const r of result) {
    r.relevance_reason = `${r.shared_entities} shared entities`;
    r.relevance_score = Math.min(1.0, r.shared_entities / Math.max(1, entityNames.length));
  }
  return result;
}

function findMemoriesByKeywords(keywords: string[], limit: number): MemoryHit[] {
  const meaningful = keywords.filter(k => k.length > 2 && !k.match(/^\d+$/)).slice(0, 10);
  if (meaningful.length === 0) return [];

  const conditions = meaningful.map(() => "(m.summary LIKE ? OR m.title LIKE ? OR m.tags LIKE ?)");
  const params: unknown[] = [];
  for (const kw of meaningful) {
    const like = `%${kw}%`;
    params.push(like, like, like);
  }

  const sql = `
    SELECT m.vault_path, m.title, m.file_type, m.date, m.strength, m.summary,
           1 as shared_entities,
           '' as snippet, 'keyword match' as relevance_reason, 0.0 as relevance_score
    FROM memory_nodes m
    WHERE (${conditions.join(" OR ")})
      AND m.status = 'active'
    ORDER BY m.strength DESC
    LIMIT ?
  `;

  const result = queryAll<MemoryHit>(sql, [...params, limit]);
  for (const r of result) {
    r.relevance_score = 0.3;
  }
  return result;
}

function mergeAndRank(
  entityHits: MemoryHit[],
  keywordHits: MemoryHit[],
  vectorHits: Map<string, { similarity: number; snippet: string }>,
  entityNames: string[]
): MemoryHit[] {
  const merged = new Map<string, MemoryHit>();

  for (const h of [...entityHits, ...keywordHits]) {
    const existing = merged.get(h.vault_path);
    if (existing) {
      existing.relevance_score = Math.max(existing.relevance_score, h.relevance_score);
      if (h.relevance_reason !== "keyword match") {
        existing.relevance_reason = h.relevance_reason;
      }
    } else {
      const vh = vectorHits.get(h.vault_path);
      if (vh) {
        h.snippet = vh.snippet;
        h.relevance_score = Math.max(h.relevance_score, vh.similarity * config.vectorWeight);
        h.relevance_reason += " + semantic similarity";
      }
      merged.set(h.vault_path, h);
    }
  }

  // Add vector-only hits
  for (const [path, info] of vectorHits) {
    if (!merged.has(path)) {
      merged.set(path, {
        vault_path: path,
        title: path.split("/").pop()?.replace(".md", "") || path,
        file_type: "knowledge",
        date: "",
        strength: 0.5,
        summary: "",
        relevance_reason: "semantic similarity",
        snippet: info.snippet,
        relevance_score: info.similarity * config.vectorWeight,
        shared_entities: 0,
      });
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score);
}

function detectContradictions(
  entityNames: string[],
  newText: string
): DetectedContradiction[] {
  if (entityNames.length === 0) return [];

  const contradictions: DetectedContradiction[] = [];

  // Check existing explicit [!contradiction] markers
  // (Enhanced: In Phase 3, also check for implicit contradictions via entity overlap)
  for (const entityName of entityNames.slice(0, 5)) {
    // Find memories with this entity that have contradiction markers
    const conflicts = queryAll<{
      vault_path: string;
      frontmatter_json: string;
    }>(
      `SELECT m.vault_path, m.frontmatter_json
       FROM memory_nodes m
       JOIN node_entities ne ON m.id = ne.node_id
       JOIN entities e ON ne.entity_id = e.id
       WHERE e.name = ? AND m.frontmatter_json LIKE '%contradiction%'`,
      [entityName]
    );

    for (const c of conflicts) {
      try {
        const fm = JSON.parse(c.frontmatter_json || "{}");
        if (fm.contradictions && fm.contradictions.length > 0) {
          contradictions.push({
            existing_memory: c.vault_path,
            existing_claim: fm.contradictions[0]?.toString() || "unknown claim",
            new_claim: newText.slice(0, 100),
            severity: "medium",
          });
        }
      } catch { /* ignore parse error */ }
    }
  }

  return contradictions;
}

function logConversationTurn(
  entities: Array<{ name: string }>,
  memories: MemoryHit[],
  sessionId?: string,
  topic?: string
): void {
  execute(
    `INSERT INTO conversation_turns
      (timestamp, session_id, topic, entities_mentioned, notes_referenced,
       summary, new_entities_count, contradictions_found)
     VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, 0)`,
    [
      sessionId || "",
      topic || "",
      JSON.stringify(entities.slice(0, 10).map(e => e.name)),
      JSON.stringify(memories.slice(0, 5).map(m => m.vault_path)),
      topic || entities.slice(0, 3).map(e => e.name).join(", "),
      entities.length,
    ]
  );
}
