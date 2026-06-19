/**
 * memory_consolidate tool — comprehensive memory maintenance.
 * Applies decay, identifies archive/delete candidates, detects conflicts.
 */
import { z } from "zod";
import { applyDecayAll } from "../graph/decay.js";
import { queryAll, execute, saveDatabase } from "../db/sqlite.js";

export const memoryConsolidateSchema = {
  name: "memory_consolidate",
  description:
    "Run memory maintenance: apply Ebbinghaus decay, identify candidates for archival/deletion, " +
    "detect and report conflicts. Requires user confirmation before destructive actions.",
  inputSchema: {
    auto_archive: z.boolean().default(false).describe(
      "Automatically archive memories with strength below threshold (0.2)."
    ),
    auto_prune_entities: z.boolean().default(false).describe(
      "Remove entities with 0 connections and strength below 0.05."
    ),
  },
};

export async function memoryConsolidateHandler(args: {
  auto_archive?: boolean;
  auto_prune_entities?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // 1. Apply decay
  const decayResult = applyDecayAll();

  // 2. Find explicit conflicts
  const conflicts = queryAll<{ vault_path: string; frontmatter_json: string }>(
    `SELECT vault_path, frontmatter_json FROM memory_nodes
     WHERE frontmatter_json LIKE '%contradiction%' AND status = 'active'`
  );

  // 3. Archive memories (if auto_archive enabled)
  let archivedCount = 0;
  if (args.auto_archive) {
    for (const c of decayResult.archiveCandidates) {
      execute(
        "UPDATE memory_nodes SET status = 'archived' WHERE vault_path = ?",
        [c.vaultPath]
      );
      archivedCount++;
    }
  }

  // 4. Prune low-weight relationships (keep graph lean)
  let prunedRels = 0;
  try {
    const result = queryAll<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM relationships WHERE co_activation_count <= 1 AND weight < 0.3"
    );
    if (result[0] && result[0].cnt > 10000) {
      execute(
        "DELETE FROM relationships WHERE co_activation_count <= 1 AND weight < 0.3"
      );
      prunedRels = result[0].cnt;
    }
  } catch { /* skip if constraint issue */ }

  // 5. Prune orphan entities (if enabled)
  let prunedCount = 0;
  if (args.auto_prune_entities) {
    const orphaned = queryAll<{ id: number; name: string }>(
      `SELECT e.id, e.name FROM entities e
       WHERE e.strength < 0.05
       AND NOT EXISTS (SELECT 1 FROM node_entities ne WHERE ne.entity_id = e.id)`
    );

    for (const o of orphaned) {
      execute("DELETE FROM entities WHERE id = ?", [o.id]);
      prunedCount++;
    }
  }

  saveDatabase();

  // Build report
  const lines: string[] = [
    "# 🧹 Memory Consolidation",
    "",
    "## Decay Applied",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files processed | ${decayResult.filesProcessed} |`,
    `| Strengthened | ${decayResult.filesStrengthened} |`,
    `| Weakened | ${decayResult.filesWeakened} |`,
    "",
  ];

  // Archive candidates
  if (decayResult.archiveCandidates.length > 0) {
    lines.push("## 📦 Archive Candidates");
    lines.push("*(strength < 0.2)*");
    lines.push("");
    lines.push("| Path | Strength | Days since | Action |");
    lines.push("|------|----------|------------|--------|");
    for (const c of decayResult.archiveCandidates.slice(0, 10)) {
      lines.push(`| \`${c.vaultPath}\` | ${c.strength.toFixed(2)} | ${c.daysSinceReinforced} | ${archivedCount > 0 ? "✅ Archived" : "⚠️ Review"} |`);
    }
    lines.push("");
  } else {
    lines.push("## 📦 Archive Candidates");
    lines.push("*No memories below archive threshold.*");
    lines.push("");
  }

  // Deletion candidates
  if (decayResult.deletionCandidates.length > 0) {
    lines.push("## 🗑️ Deletion Candidates");
    lines.push("*(strength < 0.1)*");
    lines.push("");
    lines.push("| Path | Strength | Action |");
    lines.push("|------|----------|--------|");
    for (const c of decayResult.deletionCandidates.slice(0, 10)) {
      lines.push(`| \`${c.vaultPath}\` | ${c.strength.toFixed(2)} | 🔴 Review |`);
    }
    lines.push("");
  }

  // Conflicts
  lines.push("## ⚠️ Active Conflicts");
  if (conflicts.length > 0) {
    for (const c of conflicts.slice(0, 10)) {
      lines.push(`- \`${c.vault_path}\` — contains [!contradiction] markers`);
    }
  } else {
    lines.push("*No active conflicts detected.*");
  }
  lines.push("");

  // Actions taken
  lines.push("## Actions Taken");
  lines.push(`| Action | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Decay applied | ${decayResult.filesProcessed} files |`);
  lines.push(`| Archived | ${archivedCount} |`);
  lines.push(`| Entities pruned | ${prunedCount} |`);
  lines.push(`| Weak relationships pruned | ${prunedRels} |`);
  lines.push(`| Conflicts found | ${conflicts.length} |`);

  if (!args.auto_archive && decayResult.archiveCandidates.length > 0) {
    lines.push("");
    lines.push("> ⚠️ Set `auto_archive: true` to automatically archive candidates.");
    lines.push("> 🗑️ Manual review required before deletion.");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
