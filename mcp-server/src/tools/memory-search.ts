/**
 * memory_search tool — hybrid keyword + vector search over the memory vault.
 *
 * v2: Added chunk-to-document deduplication (group by vault_path, keep highest score)
 *     and entity-based query expansion (extract entities from query, traverse graph for related terms).
 */
import { z } from "zod";
import { embedQuery } from "../embeddings/model.js";
import { searchChunks } from "../db/lancedb.js";
import { queryAll } from "../db/sqlite.js";
import { config } from "../config.js";
import { truncateToTokens } from "../utils/token-counter.js";
import { logger } from "../utils/logger.js";
import { extractEntities } from "../ingest/entity-extractor.js";

export const memorySearchSchema = {
  name: "memory_search",
  description:
    "Search the memory vault with hybrid retrieval: keyword grep + vector semantic search, ranked by relevance, " +
    "with automatic deduplication (one result per note) and entity-based query expansion. " +
    "Returns context snippets with source links.",
  inputSchema: {
    query: z.string().describe("Natural language search query."),
    file_types: z.array(z.enum(["daily", "decision", "moc", "knowledge", "all"])).default(["all"])
      .describe("Limit search to specific memory tiers."),
    max_results: z.number().default(config.defaultSearchResults)
      .describe("Maximum number of results to return (1-50)."),
    include_related: z.boolean().default(true)
      .describe("Use entity graph to expand query and find related memories."),
    date_from: z.string().optional().describe("ISO date filter (inclusive)."),
    date_to: z.string().optional().describe("ISO date filter (inclusive)."),
    min_strength: z.number().default(0.1).describe("Minimum memory strength threshold (0.0-1.0)."),
  },
};

interface SearchResult {
  rank: number;
  vault_path: string;
  title: string;
  relevance_score: number;
  vector_similarity: number;
  keyword_score: number;
  snippet: string;
  file_type: string;
  date: string;
  strength: number;
  summary: string;
  heading_path: string;
}

export async function memorySearchHandler(args: {
  query: string;
  file_types?: string[];
  max_results?: number;
  include_related?: boolean;
  date_from?: string;
  date_to?: string;
  min_strength?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const query = (args.query || "").trim();
  if (!query) {
    return {
      content: [{
        type: "text",
        text: "# Memory Search\n\n⚠️  Please provide a search query.",
      }],
    };
  }

  const maxResults = Math.min(args.max_results || config.defaultSearchResults, config.maxSearchResults);
  const minStrength = args.min_strength ?? 0.1;

  const startTime = Date.now();

  // ── Query expansion: extract entities from query, find graph neighbors ──
  let expandedTerms: string[] = [];
  if (args.include_related !== false) {
    try {
      const entities = extractEntities(query, { minConfidence: 0.35, entityTypes: "all" });
      const topEntities = entities.slice(0, 5).map(e => e.name);

      // Look up 1-hop graph neighbors for each entity
      for (const entityName of topEntities) {
        const neighbors = queryAll<{ target_name: string; weight: number }>(
          `SELECT DISTINCT
             CASE WHEN r.source_entity_id = e1.id THEN e2.name ELSE e1.name END as target_name,
             r.weight
           FROM entities e1
           JOIN relationships r ON (r.source_entity_id = e1.id OR r.target_entity_id = e1.id)
           JOIN entities e2 ON (
             (r.source_entity_id = e2.id AND r.target_entity_id = e1.id)
             OR (r.target_entity_id = e2.id AND r.source_entity_id = e1.id)
           )
           WHERE e1.name = ? AND r.weight >= 0.4
           ORDER BY r.weight DESC
           LIMIT 5`,
          [entityName]
        );
        for (const n of neighbors) {
          if (!expandedTerms.includes(n.target_name) && !topEntities.includes(n.target_name)) {
            expandedTerms.push(n.target_name);
          }
        }
      }
      if (expandedTerms.length > 0) {
        logger.debug(`Query expansion: ${topEntities.join(", ")} → +${expandedTerms.slice(0, 5).join(", ")}`);
      }
    } catch { /* query expansion is non-critical */ }
  }

  // ── Pass 1: Keyword search (with expanded terms) ──
  const keywordResults = keywordSearch(
    query, expandedTerms, args.file_types, args.date_from, args.date_to,
    minStrength, maxResults * 2
  );

  // ── Pass 2: Vector search with dedup by vault_path ──
  let vectorResults = new Map<string, { similarity: number; snippet: string; heading_path: string }>();
  try {
    const queryVector = await embedQuery(query);
    if (queryVector.some(v => v !== 0)) {
      const vectorHits = await searchChunks(Array.from(queryVector), maxResults * 4);
      // Dedup: group by vault_path, keep only highest-scoring chunk per note
      const bestPerPath = new Map<string, { similarity: number; snippet: string; heading_path: string }>();
      for (const hit of vectorHits) {
        const path = hit.row.vault_path;
        const existing = bestPerPath.get(path);
        if (!existing || hit.score > existing.similarity) {
          bestPerPath.set(path, {
            similarity: hit.score,
            snippet: hit.row.chunk_text,
            heading_path: hit.row.heading_path,
          });
        }
      }
      vectorResults = bestPerPath;
    }
  } catch (err) {
    logger.warn(`Vector search failed, falling back to keyword-only: ${err}`);
  }

  // ── Merge, rank, and deduplicate ──
  const merged = mergeResults(keywordResults, vectorResults, maxResults);

  // ── Build response ──
  const elapsed = Date.now() - startTime;

  const lines: string[] = [
    `# Memory Search: "${query}"`,
    "",
    `Found **${merged.length}** results (${elapsed}ms)`,
  ];
  if (expandedTerms.length > 0) {
    lines.push(`*Query expanded with: ${expandedTerms.slice(0, 5).join(", ")}*`);
  }
  lines.push("");

  if (merged.length === 0) {
    lines.push("No matching memories found. Try different keywords or run `memory_ingest` first.");
  }

  for (const r of merged) {
    lines.push(`## ${r.rank}. ${r.title || r.vault_path}`);
    lines.push(`- **Path**: \`${r.vault_path}\` (${r.file_type}, ${r.date || "?"})`);
    lines.push(`- **Relevance**: ${r.relevance_score.toFixed(2)} (vector: ${r.vector_similarity.toFixed(2)}, keyword: ${r.keyword_score.toFixed(2)})`);
    lines.push(`- **Strength**: ${r.strength.toFixed(2)}`);
    if (r.summary) lines.push(`- **Summary**: ${r.summary}`);
    if (r.heading_path) lines.push(`- **Section**: ${r.heading_path}`);
    lines.push("");
    lines.push("```");
    lines.push(truncateToTokens(r.snippet || r.summary, 200));
    lines.push("```");
    lines.push("");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}

/**
 * Keyword search with optional query expansion terms.
 */
function keywordSearch(
  query: string,
  expandedTerms: string[],
  fileTypes?: string[],
  dateFrom?: string,
  dateTo?: string,
  minStrength?: number,
  limit?: number
): SearchResult[] {
  const conditions: string[] = ["m.status = 'active'"];
  const params: unknown[] = [];

  if (fileTypes && fileTypes.length > 0 && !fileTypes.includes("all")) {
    conditions.push(`m.file_type IN (${fileTypes.map(() => "?").join(",")})`);
    params.push(...fileTypes);
  }

  if (dateFrom) { conditions.push("m.date >= ?"); params.push(dateFrom); }
  if (dateTo)   { conditions.push("m.date <= ?"); params.push(dateTo); }
  if (minStrength !== undefined) { conditions.push("m.strength >= ?"); params.push(minStrength); }

  // Combine original keywords + expanded terms
  const allKeywords = [
    ...query.split(/[\s,，。！？]+/).filter(k => k.length > 0),
    ...expandedTerms,
  ];
  // Deduplicate while preserving order
  const keywords = [...new Set(allKeywords)];

  const keywordConditions: string[] = [];
  const keywordScores: string[] = [];
  for (const kw of keywords) {
    const like = `%${kw}%`;
    keywordConditions.push("(m.summary LIKE ? OR m.tags LIKE ? OR m.title LIKE ? OR m.vault_path LIKE ?)");
    keywordScores.push("(CASE WHEN m.summary LIKE ? OR m.tags LIKE ? OR m.title LIKE ? OR m.vault_path LIKE ? THEN 1.0 ELSE 0.0 END)");
    params.push(like, like, like, like);
    params.push(like, like, like, like);
  }

  if (keywordConditions.length > 0) {
    conditions.push(`(${keywordConditions.join(" OR ")})`);
  }

  const whereClause = conditions.join(" AND ");
  const keywordScoreExpr = keywordScores.length > 0 ? keywordScores.join(" + ") : "0.0";
  const sql = `
    SELECT m.vault_path, m.title, m.file_type, m.date, m.strength, m.summary,
           1.0 as relevance_score, 0.0 as vector_similarity,
           ${keywordScoreExpr} as keyword_score,
           '' as snippet, '' as heading_path
    FROM memory_nodes m
    WHERE ${whereClause}
    ORDER BY keyword_score DESC, m.strength DESC
    LIMIT ?
  `;

  return queryAll<SearchResult>(sql, [...params, limit || 20]);
}

/**
 * Merge keyword and vector results.
 * Deduplication: vault_path appears at most once; vector-only entries fill gaps.
 */
function mergeResults(
  keywordResults: SearchResult[],
  vectorResults: Map<string, { similarity: number; snippet: string; heading_path: string }>,
  maxResults: number
): SearchResult[] {
  const merged = new Map<string, SearchResult>();

  // Process keyword results first (they already have rich metadata)
  for (const r of keywordResults) {
    const vh = vectorResults.get(r.vault_path);
    if (vh) {
      r.vector_similarity = vh.similarity;
      if (!r.snippet) r.snippet = vh.snippet;
      if (!r.heading_path) r.heading_path = vh.heading_path;
      vectorResults.delete(r.vault_path); // consumed — won't duplicate
    }
    r.keyword_score = Math.min(1.0, r.keyword_score / Math.max(1, r.keyword_score)); // normalize
    r.relevance_score =
      config.vectorWeight * r.vector_similarity +
      config.keywordWeight * r.keyword_score +
      config.recencyWeight * (r.date ? recentnessBonus(r.date) : 0.5) +
      config.strengthWeight * r.strength;
    merged.set(r.vault_path, r);
  }

  // Remaining vector-only results
  for (const [path, info] of vectorResults) {
    if (!merged.has(path)) {
      merged.set(path, {
        rank: 0,
        vault_path: path,
        title: path.split("/").pop()?.replace(".md", "") || path,
        relevance_score: config.vectorWeight * info.similarity,
        vector_similarity: info.similarity,
        keyword_score: 0,
        snippet: info.snippet,
        file_type: "knowledge",
        date: "",
        strength: 0.5,
        summary: "",
        heading_path: info.heading_path,
      });
    }
  }

  const sorted = [...merged.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, maxResults);

  sorted.forEach((r, i) => { r.rank = i + 1; });
  return sorted;
}

function recentnessBonus(dateStr: string): number {
  if (!dateStr) return 0.5;
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const daysAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-daysAgo / 30);
  } catch { return 0.5; }
}
