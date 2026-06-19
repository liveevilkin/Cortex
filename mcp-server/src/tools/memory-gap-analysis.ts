/**
 * memory_gap_analysis tool — identify knowledge gaps relative to learning goals.
 */
import { z } from "zod";
import { analyzeGaps } from "../graph/gap-detector.js";

export const memoryGapAnalysisSchema = {
  name: "memory_gap_analysis",
  description:
    "Analyze the current state of knowledge relative to defined learning goals. " +
    "Identifies topics with low coverage, missing prerequisites, and suggests learning priorities.",
  inputSchema: {
    goal_vault_path: z.string().optional().describe(
      "Path to a learning plan document (e.g., '学习计划/实施顾问岗位-能力分析与学习规划.md'). " +
      "If omitted, analyzes all known learning goals."
    ),
    include_suggestions: z.boolean().default(true).describe(
      "Include resource suggestions for filling gaps."
    ),
  },
};

export async function memoryGapAnalysisHandler(args: {
  goal_vault_path?: string;
  include_suggestions?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = analyzeGaps(args.goal_vault_path);

  const lines: string[] = [
    "# 📊 Knowledge Gap Analysis",
    "",
    `## Goals Analyzed`,
    ...result.goalsAnalyzed.map(g => `- \`${g}\``),
    "",
    "## Summary",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total gaps | ${result.summary.totalGaps} |`,
    `| Critical gaps | ${result.summary.criticalGaps} |`,
    `| Overall readiness | ${(result.summary.overallReadiness * 100).toFixed(0)}% |`,
    "",
  ];

  if (result.gaps.length === 0) {
    lines.push("✅ No significant knowledge gaps found. All required topics have good coverage.");
  } else {
    lines.push("## Gaps (by priority)", "");

    const priorities = ["critical", "high", "medium", "low"] as const;
    for (const priority of priorities) {
      const gaps = result.gaps.filter(g => g.priority === priority);
      if (gaps.length === 0) continue;

      const icon = priority === "critical" ? "🔴" : priority === "high" ? "🟠" : priority === "medium" ? "🟡" : "🟢";

      lines.push(`### ${icon} ${priority.toUpperCase()} (${gaps.length})`);
      lines.push("");

      for (const g of gaps.slice(0, 10)) {
        lines.push(`#### ${g.topic}`);
        lines.push(`- **Required by**: \`${g.requiredByGoal}\``);
        lines.push(`- **Coverage**: ${(g.currentCoverage * 100).toFixed(0)}%`);
        lines.push(`- **Status**: ${g.status}`);
        lines.push(`- **Existing memories**: ${g.existingMemories.length}`);

        if (g.existingMemories.length > 0) {
          for (const m of g.existingMemories.slice(0, 3)) {
            lines.push(`  - \`${m.vaultPath}\` (+${(m.coverageContribution * 100).toFixed(0)}%)`);
          }
        }

        if (args.include_suggestions !== false && g.suggestedResources.length > 0) {
          lines.push(`- **Suggestions**:`);
          for (const s of g.suggestedResources) {
            lines.push(`  - [${s.type}] ${s.description}`);
          }
        }
        lines.push("");
      }

      if (gaps.length > 10) {
        lines.push(`*... and ${gaps.length - 10} more ${priority}-priority gaps*`);
        lines.push("");
      }
    }
  }

  lines.push(
    "> 💡 Use `memory_search` to find existing memories for any gap topic.",
    "> Run `memory_ingest` after creating new notes to update coverage scores."
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
