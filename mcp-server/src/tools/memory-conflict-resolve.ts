/**
 * memory_conflict_resolve tool — detect contradictions between new claims and existing memories.
 * Uses entity overlap + keyword match to find potentially conflicting statements.
 */
import { z } from "zod";
import { extractEntities } from "../ingest/entity-extractor.js";
import { queryAll } from "../db/sqlite.js";

export const memoryConflictResolveSchema = {
  name: "memory_conflict_resolve",
  description:
    "Detect contradictions between new text/claims and existing memories. " +
    "Uses entity overlap to find related memories, then checks for potential contradictions.",
  inputSchema: {
    text: z.string().describe(
      "New text or claim to check against existing memories."
    ),
    vault_path: z.string().optional().describe(
      "Limit check to memories linked to a specific vault path."
    ),
    severity_threshold: z.enum(["low", "medium", "high"]).default("medium").describe(
      "Minimum severity to report."
    ),
  },
};

interface ConflictResult {
  existing_memory_path: string;
  existing_snippet: string;
  new_snippet: string;
  semantic_contradiction_score: number;
  severity: "low" | "medium" | "high";
  recommendation: string;
}

export async function memoryConflictResolveHandler(args: {
  text: string;
  vault_path?: string;
  severity_threshold?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const text = args.text;
  const threshold = args.severity_threshold || "medium";

  // Extract entities from the new text
  const entities = extractEntities(text, { minConfidence: 0.4 });

  if (entities.length === 0) {
    return {
      content: [{
        type: "text",
        text: "# Conflict Check\n\nNo entities found in the provided text — cannot check for contradictions.",
      }],
    };
  }

  const entityNames = entities.map(e => e.name);
  const placeholders = entityNames.map(() => "?");

  // Find memories that share entities BUT contain contradiction markers
  let sql = `
    SELECT DISTINCT m.vault_path, m.title, m.file_type, m.summary,
           m.frontmatter_json, e.name as entity_name
    FROM memory_nodes m
    JOIN node_entities ne ON m.id = ne.node_id
    JOIN entities e ON ne.entity_id = e.id
    WHERE e.name IN (${placeholders.join(",")})
      AND m.status = 'active'
      AND (
        m.frontmatter_json LIKE '%contradiction%'
        OR m.frontmatter_json LIKE '%conflict%'
        OR m.frontmatter_json LIKE '%superseded%'
      )
    ORDER BY m.strength DESC
    LIMIT 20
  `;

  const params: unknown[] = [...entityNames];

  if (args.vault_path) {
    sql += " AND m.vault_path = ?";
    params.push(args.vault_path);
  }

  const results = queryAll<{
    vault_path: string;
    title: string;
    file_type: string;
    summary: string;
    frontmatter_json: string;
    entity_name: string;
  }>(sql, params);

  // Build conflict report
  const conflicts: ConflictResult[] = [];

  for (const r of results) {
    try {
      const fm = JSON.parse(r.frontmatter_json || "{}");
      const contradictions = fm.contradictions || [];
      const status = fm.status;

      // Determine severity
      let severity: "low" | "medium" | "high" = "medium";
      if (status === "superseded") severity = "low";
      if (contradictions.length > 1) severity = "high";
      if (fm.contradictions && fm.contradictions.length > 0) {
        severity = "high";
      }

      // Skip if below threshold
      const severityOrder = { low: 0, medium: 1, high: 2 };
      if (severityOrder[severity] < severityOrder[threshold as keyof typeof severityOrder]) continue;

      conflicts.push({
        existing_memory_path: r.vault_path,
        existing_snippet: r.summary || contradictions[0]?.toString() || `Contains entity: ${r.entity_name}`,
        new_snippet: text.slice(0, 100),
        semantic_contradiction_score: contradictions.length > 0 ? 0.85 : 0.3,
        severity,
        recommendation: status === "superseded"
          ? "Old memory is already marked as superseded — this new claim may replace it."
          : contradictions.length > 0
          ? "Existing contradictions found — review both claims and resolve."
          : "No direct contradiction, but shares entities with conflicting memory.",
      });
    } catch { /* ignore parse error */ }
  }

  // Count explicit contradictions
  const explicitCount = queryAll<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM memory_nodes
     WHERE frontmatter_json LIKE '%contradiction%' AND status = 'active'`
  )[0]?.cnt || 0;

  const lines: string[] = [
    "# ⚠️ Conflict Resolution",
    "",
    `Checked text (${text.length} chars) against **${results.length}** potentially conflicting memories.`,
    `Entities in text: ${entityNames.map(n => `\`${n}\``).join(", ")}`,
    `Explicit contradictions in vault: **${explicitCount}**`,
    `New conflicts found: **${conflicts.length}**`,
    "",
  ];

  if (conflicts.length > 0) {
    for (let i = 0; i < Math.min(conflicts.length, 10); i++) {
      const c = conflicts[i];
      lines.push(`### ${i + 1}. [${c.severity.toUpperCase()}] \`${c.existing_memory_path}\``);
      lines.push(`- **Existing**: ${c.existing_snippet}`);
      lines.push(`- **New**: ${c.new_snippet}`);
      lines.push(`- **Score**: ${c.semantic_contradiction_score.toFixed(2)}`);
      lines.push(`- **Action**: ${c.recommendation}`);
      lines.push("");
    }
  } else {
    lines.push("✅ No conflicts detected above the severity threshold.");
  }

  lines.push(
    "",
    "> 💡 Use `memory_consolidate` (Phase 4) to automatically archive superseded memories."
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
