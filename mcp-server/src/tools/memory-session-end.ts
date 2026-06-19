/**
 * memory_session_end tool — generates daily notes from session buffer.
 * Replaces the Stop hook for non-Claude-Code editors.
 */
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { queryAll, queryOne, execute, saveDatabase } from "../db/sqlite.js";
import { estimateTokens } from "../utils/token-counter.js";
import { checkCacheAnchor } from "../utils/cache-utils.js";
import { logger } from "../utils/logger.js";

export const memorySessionEndSchema = {
  name: "memory_session_end",
  description:
    "End a session: generate a daily note and update the memory index. " +
    "Call this at the end of each session. Replaces the Claude Code Stop hook.",
  inputSchema: {
    summary: z.string().describe("One-line summary of what was accomplished this session."),
    findings: z.array(z.string()).optional().describe("Key discoveries or decisions made."),
    next_steps: z.array(z.string()).optional().describe("Planned next actions."),
    files_changed: z.array(z.string()).optional().describe("Paths of files modified."),
  },
};

export async function memorySessionEndHandler(args: {
  summary: string;
  findings?: string[];
  next_steps?: string[];
  files_changed?: string[];
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const today = new Date().toISOString().slice(0, 10);
  const dailyDir = join(config.primaryVault, "daily");
  const dailyFile = join(dailyDir, `${today}.md`);
  const indexPath = join(config.primaryVault, config.memoryIndexFile);

  // Ensure daily directory exists
  if (!existsSync(dailyDir)) {
    mkdirSync(dailyDir, { recursive: true });
  }

  // Read existing daily file or create new
  let existingContent = "";
  if (existsSync(dailyFile)) {
    existingContent = readFileSync(dailyFile, "utf-8");
    // Remove closing frontmatter to append
    const fmEnd = existingContent.indexOf("---\n", 4);
    if (fmEnd > 0) {
      existingContent = existingContent.slice(fmEnd + 4);
    }
  }

  // Build file changes list
  const changedFiles = args.files_changed?.slice(0, 20) || [];
  const filesList = changedFiles.map(f => `  - "${f}"`).join("\n");

  // Build findings
  const findingsList = args.findings?.map(f => `- ${f}`).join("\n") || "";

  // Build next steps
  const nextList = args.next_steps?.map(s => `- ${s}`).join("\n") || "";

  const frontmatter = [
    "---",
    `date: ${today}`,
    "tags: [daily-memory]",
    `summary: "${args.summary}"`,
    "strength: 1.0",
    `last_reinforced: ${today}`,
    "decay_curve: ebbinghaus",
    "links: []",
    "contradictions: []",
    `files_changed:`,
    ...(changedFiles.length > 0 ? changedFiles.map(f => `  - "${f}"`) : ["  - [none]"]),
    "---",
    "",
    "## 做了什么",
    args.summary,
  ];

  if (findingsList) {
    frontmatter.push("", "## 关键发现", findingsList);
  }
  if (nextList) {
    frontmatter.push("", "## 下一步", nextList);
  }
  if (changedFiles.length > 0) {
    frontmatter.push("", "## 重要文件变更");
    for (const f of changedFiles) {
      frontmatter.push(`- \`${f}\``);
    }
  }

  frontmatter.push("", existingContent.trim());

  // Write daily file
  writeFileSync(dailyFile, frontmatter.join("\n") + "\n");
  logger.info(`Daily note written: ${dailyFile}`);

  // Update memory-index (append-only, with cache anchor protection)
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, "utf-8");
    const anchor = checkCacheAnchor();
    if (!anchor.valid) {
      return {
        content: [{
          type: "text",
          text: `# ❌ Session End Failed\n\nCache anchor validation failed: ${anchor.error}\nDaily note was written but index was NOT updated to protect prompt cache.`,
        }],
      };
    }

    // Update the 'updated' date in frontmatter
    let updated = indexContent.replace(
      /^(updated:\s*).*$/m,
      `$1${today}`
    );

    // Add today to recent dynamics if not present
    if (!updated.includes(`daily/${today}`)) {
      const newRow = `| ${today} | ${args.summary.slice(0, 50)} | [[daily/${today}]] |`;
      // Insert after the table header
      updated = updated.replace(
        /(\|------\|------\|------\|)/,
        `$1\n${newRow}`
      );
    }

    writeFileSync(indexPath, updated);
  }

  // Also update SQLite memory node (if already indexed)
  const node = queryOne<{ id: number }>(
    "SELECT id FROM memory_nodes WHERE vault_path = ?",
    [`daily/${today}.md`]
  );
  if (node) {
    execute(
      `UPDATE memory_nodes SET
        summary = ?, strength = 1.0, last_reinforced = ?, file_mtime = ?
       WHERE vault_path = ?`,
      [args.summary, today, new Date().toISOString(), `daily/${today}.md`]
    );
    saveDatabase();
  }

  const lines: string[] = [
    "# ✅ Session Saved",
    "",
    `Daily note: \`daily/${today}.md\``,
    `Summary: ${args.summary}`,
    `Files tracked: ${changedFiles.length}`,
    "",
    "> 💡 Run `memory_ingest` next session to index the new daily note.",
  ];

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
