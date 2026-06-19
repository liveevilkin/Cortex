/**
 * MCP Resource: memory://session/start
 * Returns T0 (memory-index) + T1 (recent daily logs) context for session startup.
 * Replaces the SessionStart hook for non-Claude-Code editors.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { queryAll } from "../db/sqlite.js";
import { estimateTokens } from "../utils/token-counter.js";
import { checkCacheAnchor } from "../utils/cache-utils.js";
import { logger } from "../utils/logger.js";

export async function getSessionContext(): Promise<string> {
  const parts: string[] = [];
  parts.push("<!-- memory:session/start — auto-generated context -->");
  parts.push("");

  // T0: memory-index
  const indexPath = join(config.primaryVault, config.memoryIndexFile);
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, "utf-8");
    const tokens = estimateTokens(indexContent);
    const anchor = checkCacheAnchor();
    parts.push(`## 📋 Memory Index (~${tokens} tokens, cache: ${anchor.valid ? "✅" : "⚠️"})`);
    parts.push("");
    parts.push(indexContent);
    parts.push("");
  }

  // T1: Recent daily logs (last 3)
  const recentDaily = queryAll<{ vault_path: string; date: string; summary: string }>(
    `SELECT vault_path, date, summary FROM memory_nodes
     WHERE file_type = 'daily' AND status = 'active'
     ORDER BY date DESC LIMIT 3`
  );

  if (recentDaily.length > 0) {
    parts.push("## 📅 Recent Daily Logs");
    parts.push("");
    for (const d of recentDaily) {
      const dailyPath = join(config.primaryVault, d.vault_path);
      if (existsSync(dailyPath)) {
        try {
          const content = readFileSync(dailyPath, "utf-8");
          const tokens = estimateTokens(content);
          parts.push(`### ${d.vault_path} (~${tokens} tokens)`);
          parts.push("");
          parts.push(content.slice(0, 2000)); // Truncate to ~500 tokens per daily
          parts.push("");
          if (content.length > 2000) parts.push("*(truncated)*");
          parts.push("");
        } catch { /* skip unreadable */ }
      }
    }
  }

  // T1b: Active conflicts
  const conflicts = queryAll<{ vault_path: string }>(
    `SELECT vault_path FROM memory_nodes
     WHERE frontmatter_json LIKE '%contradiction%' AND status = 'active'`
  );
  if (conflicts.length > 0) {
    parts.push("## ⚠️ Active Conflicts");
    parts.push("");
    for (const c of conflicts) {
      parts.push(`- \`${c.vault_path}\``);
    }
    parts.push("");
  }

  return parts.join("\n");
}

export function registerContextResource(server: {
  resource: (name: string, uri: string, readCallback: (uri: URL) => Promise<{
    contents: Array<{ uri: string; text: string; mimeType?: string }>;
  }>) => unknown;
}): void {
  server.resource(
    "memory_session_start",
    "memory://session/start",
    async (_uri: URL) => {
      try {
        const text = await getSessionContext();
        return {
          contents: [{ uri: "memory://session/start", text, mimeType: "text/markdown" }],
        };
      } catch (err) {
        logger.error(`Session context resource failed: ${err}`);
        return {
          contents: [{ uri: "memory://session/start", text: "# Memory Context\n\nFailed to load.", mimeType: "text/markdown" }],
        };
      }
    }
  );
}
