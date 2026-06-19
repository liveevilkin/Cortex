/**
 * Knowledge gap detector — parses learning plan documents, cross-references
 * with the knowledge graph, and identifies topics with low coverage.
 *
 * Phase 4: Proactive analysis.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { queryOne, queryAll, execute } from "../db/sqlite.js";
import { extractEntities } from "../ingest/entity-extractor.js";

export interface KnowledgeGap {
  topic: string;
  requiredByGoal: string;
  currentCoverage: number;   // 0.0–1.0
  priority: "critical" | "high" | "medium" | "low";
  existingMemories: Array<{
    vaultPath: string;
    coverageContribution: number;
  }>;
  suggestedResources: Array<{
    type: string;             // "note" | "course" | "documentation" | "practice"
    description: string;
  }>;
  status: "open" | "in_progress" | "resolved";
}

export interface GapAnalysisResult {
  goalsAnalyzed: string[];
  gaps: KnowledgeGap[];
  summary: {
    totalGaps: number;
    criticalGaps: number;
    overallReadiness: number; // 0.0–1.0
  };
}

/**
 * Analyze knowledge gaps relative to learning goals.
 */
export function analyzeGaps(goalVaultPath?: string): GapAnalysisResult {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Find goal documents
  const goalPaths = goalVaultPath
    ? [goalVaultPath]
    : findGoalDocuments();

  const goalsAnalyzed: string[] = [];
  const allGaps: KnowledgeGap[] = [];

  for (const goalPath of goalPaths) {
    const content = readGoalContent(goalPath);
    if (!content) continue;

    goalsAnalyzed.push(goalPath);

    // 2. Extract required topics from the goal document
    const requiredTopics = extractRequiredTopics(content, goalPath);

    // 3. For each required topic, check coverage in the knowledge graph
    for (const topic of requiredTopics) {
      const coverage = assessTopicCoverage(topic);

      if (coverage.score < 0.8) {
        // This is a gap
        const priority = determinePriority(coverage.score, topic);
        const suggestions = generateSuggestions(topic, coverage.score);

        allGaps.push({
          topic,
          requiredByGoal: goalPath.replace(/\.md$/, ""),
          currentCoverage: coverage.score,
          priority,
          existingMemories: coverage.memories,
          suggestedResources: suggestions,
          status: coverage.score > 0.5 ? "in_progress" : "open",
        });
      }
    }
  }

  // 4. Sort gaps by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allGaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // 5. Write gaps to database for tracking
  for (const gap of allGaps) {
    execute(
      `INSERT OR REPLACE INTO knowledge_gaps
        (topic, related_goal, related_goal_path, current_coverage,
         priority, suggested_resources, detected_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        gap.topic,
        gap.requiredByGoal,
        goalVaultPath || "",
        gap.currentCoverage,
        gap.priority,
        gap.suggestedResources.map(r => r.description).join("; "),
        today,
        gap.status,
      ]
    );
  }

  const criticalGaps = allGaps.filter(g => g.priority === "critical").length;
  const avgCoverage = allGaps.length > 0
    ? allGaps.reduce((s, g) => s + g.currentCoverage, 0) / allGaps.length
    : 1.0;

  return {
    goalsAnalyzed,
    gaps: allGaps,
    summary: {
      totalGaps: allGaps.length,
      criticalGaps,
      overallReadiness: 1.0 - (criticalGaps * 0.3 + allGaps.filter(g => g.priority === "high").length * 0.15) / Math.max(1, allGaps.length + 1),
    },
  };
}

/**
 * Find goal/learning-plan documents in the vault.
 */
function findGoalDocuments(): string[] {
  const paths: string[] = [];
  const vaults = [config.primaryVault, ...config.additionalVaults];

  for (const vault of vaults) {
    // Look for files with "学习", "路线", "规划", "岗位" in the name
    const keywords = ["学习", "路线", "岗位", "目标", "计划", "goal", "plan"];
    try {
      const files = walkDir(vault);
      for (const f of files) {
        const name = f.toLowerCase();
        if (keywords.some(k => name.includes(k)) && f.endsWith(".md")) {
          if (!f.includes("/templates/") && !f.includes("/daily/")) {
            paths.push(f);
          }
        }
      }
    } catch { /* vault not accessible */ }
  }

  return paths.slice(0, 10); // limit to 10 goal docs
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".")) {
        results.push(...walkDir(full));
      } else if (e.isFile()) {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}

function readGoalContent(vaultPath: string): string | null {
  const vaults = [config.primaryVault, ...config.additionalVaults];

  for (const vault of vaults) {
    const vaultName = vault.split("/").pop() || "";
    const adjustedPath = vaultPath.replace(/\\/g, "/");

    // Try: direct join with vault
    const fullPath = join(vault, adjustedPath);
    if (existsSync(fullPath)) {
      try { return readFileSync(fullPath, "utf-8"); } catch (err) { logger.warn(`Cannot read ${fullPath}: ${err}`); }
    }

    // Try: strip vault-name prefix (e.g., "学习计划/file.md" → "file.md" when vault is ".../学习计划")
    if (adjustedPath.startsWith(vaultName + "/")) {
      const strippedPath = join(vault, adjustedPath.slice(vaultName.length + 1));
      if (strippedPath !== fullPath && existsSync(strippedPath)) {
        try { return readFileSync(strippedPath, "utf-8"); } catch (err) { logger.warn(`Cannot read ${strippedPath}: ${err}`); }
      }
    }

    // Try: just the vaultPath as-is inside vault
    const segments = adjustedPath.split("/");
    for (let s = 0; s < segments.length; s++) {
      const subPath = join(vault, ...segments.slice(s));
      if (subPath !== fullPath && existsSync(subPath)) {
        try { return readFileSync(subPath, "utf-8"); } catch { /* ignore */ }
      }
    }
  }

  // Try vaultPath as absolute
  if (existsSync(vaultPath)) {
    try { return readFileSync(vaultPath, "utf-8"); } catch { /* ignore */ }
  }

  logger.warn(`Goal document not found: ${vaultPath}`);
  return null;
}

/**
 * Extract required topics from a goal document.
 * Uses entity extraction + heading analysis.
 */
function extractRequiredTopics(content: string, goalPath: string): string[] {
  const topics = new Set<string>();

  // 1. Extract entities (technologies, skills, concepts)
  const entities = extractEntities(content, {
    entityTypes: ["technology", "skill", "concept", "domain"],
    minConfidence: 0.5,
  });

  for (const e of entities) {
    topics.add(e.name);
  }

  // 2. Extract ## heading topics (often represent learning modules)
  const headingMatch = content.matchAll(/^##\s+(.+)/gm);
  for (const m of headingMatch) {
    const heading = m[1].trim();
    // Filter out generic headings
    if (!heading.match(/相关笔记|总结|参考|链接|步骤|目录|前言|简介/)) {
      topics.add(heading.slice(0, 40)); // truncate long headings
    }
  }

  // 3. Extract numbered list items (often skill breakdowns)
  const listMatch = content.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm);
  for (const m of listMatch) {
    topics.add(m[1].trim().slice(0, 40));
  }

  return [...topics].slice(0, 30); // cap at 30 topics per document
}

/**
 * Assess how well a topic is covered by existing memories.
 */
function assessTopicCoverage(topic: string): {
  score: number;
  memories: Array<{ vaultPath: string; coverageContribution: number }>;
} {
  const memories: Array<{ vaultPath: string; coverageContribution: number }> = [];

  // 1. Check if there's an entity for this topic
  const entity = queryOne<{ id: number; strength: number; occurrence_count: number }>(
    "SELECT id, strength, occurrence_count FROM entities WHERE name LIKE ?",
    [`%${topic}%`]
  );

  if (entity) {
    // 2. Find connected memory nodes
    const nodes = queryAll<{ vault_path: string; strength: number; mention_count: number }>(
      `SELECT m.vault_path, m.strength, ne.mention_count
       FROM memory_nodes m
       JOIN node_entities ne ON m.id = ne.node_id
       WHERE ne.entity_id = ? AND m.status = 'active'
       ORDER BY m.strength DESC
       LIMIT 5`,
      [entity.id]
    );

    for (const n of nodes) {
      memories.push({
        vaultPath: n.vault_path,
        coverageContribution: n.strength * 0.2, // up to 0.2 per memory
      });
    }
  }

  // 3. Keyword search in memory summaries
  const kwNodes = queryAll<{ vault_path: string; strength: number }>(
    `SELECT vault_path, strength FROM memory_nodes
     WHERE status = 'active' AND (summary LIKE ? OR title LIKE ?)
     LIMIT 3`,
    [`%${topic}%`, `%${topic}%`]
  );

  for (const n of kwNodes) {
    if (!memories.some(m => m.vaultPath === n.vault_path)) {
      memories.push({
        vaultPath: n.vault_path,
        coverageContribution: n.strength * 0.15,
      });
    }
  }

  const score = Math.min(1.0, memories.reduce((s, m) => s + m.coverageContribution, 0));
  return { score, memories };
}

function determinePriority(score: number, topic: string): "critical" | "high" | "medium" | "low" {
  if (score < 0.1) return "critical";
  if (score < 0.3) return "high";
  if (score < 0.6) return "medium";
  return "low";
}

function generateSuggestions(topic: string, score: number): Array<{ type: string; description: string }> {
  const suggestions: Array<{ type: string; description: string }> = [];

  if (score < 0.3) {
    suggestions.push({ type: "course", description: `开始学习 ${topic} 的基础知识` });
    suggestions.push({ type: "practice", description: `找一个 ${topic} 相关的练手项目` });
  } else if (score < 0.6) {
    suggestions.push({ type: "documentation", description: `深入学习 ${topic} 的官方文档` });
    suggestions.push({ type: "note", description: `整理 ${topic} 的学习笔记到 Obsidian` });
  } else {
    suggestions.push({ type: "practice", description: `通过实际项目巩固 ${topic}` });
  }
  suggestions.push({ type: "note", description: `在 Obsidian 中创建 ${topic} 的 MOC 笔记` });

  return suggestions;
}
