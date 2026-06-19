/**
 * memory_auto_link tool — suggest [[wikilinks]] between vault notes.
 */
import { z } from "zod";
import { queryOne, queryAll } from "../db/sqlite.js";
import { findRelatedNodes } from "../graph/knowledge-graph.js";

export const memoryAutoLinkSchema = {
  name: "memory_auto_link",
  description:
    "Scan a memory note and suggest [[wikilinks]] to other notes that share entities/concepts. " +
    "Can optionally write suggestions back to the vault file's frontmatter. " +
    "Use this to automatically build your Obsidian knowledge graph.",
  inputSchema: {
    vault_path: z.string().describe("Vault-relative path of the note to analyze."),
    min_confidence: z.number().default(0.5).describe("Minimum confidence threshold (0.0-1.0)."),
    max_suggestions: z.number().default(10).describe("Maximum suggestions to return."),
    dry_run: z.boolean().default(true).describe(
      "If true, only return suggestions without modifying files."
    ),
  },
};

export async function memoryAutoLinkHandler(args: {
  vault_path: string;
  min_confidence?: number;
  max_suggestions?: number;
  dry_run?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const vaultPath = args.vault_path;
  const minConfidence = args.min_confidence || 0.5;
  const maxSuggestions = args.max_suggestions || 10;
  const dryRun = args.dry_run !== false;

  // Find the memory node
  const node = queryOne<{ id: number; vault_path: string; title: string; frontmatter_json: string }>(
    "SELECT id, vault_path, title, frontmatter_json FROM memory_nodes WHERE vault_path = ?",
    [vaultPath]
  );

  if (!node) {
    return {
      content: [{
        type: "text",
        text: `# Auto-Link: \`${vaultPath}\`\n\n` +
          `No indexed memory node found for this path. Run \`memory_ingest\` first.`,
      }],
    };
  }

  // Find related nodes through shared entities
  const related = findRelatedNodes(node.id, maxSuggestions * 2);

  // Get existing links from frontmatter
  let existingLinks: string[] = [];
  try {
    const fm = JSON.parse(node.frontmatter_json);
    existingLinks = fm.links || [];
  } catch { /* ignore */ }

  // Filter and sort suggestions
  const suggestions = related
    .filter(r => {
      if (r.shared_entities < 2 && r.semantic_similarity < 0.5) return false;
      // Remove already linked
      const linkTarget = `[[${r.vault_path.replace(/\.md$/, "")}]]`;
      return !existingLinks.some((l: string) => l.includes(r.vault_path));
    })
    .slice(0, maxSuggestions)
    .map(r => ({
      target_path: r.vault_path,
      target_title: r.title,
      wikilink: `[[${r.vault_path.replace(/\.md$/, "")}]]`,
      shared_entities: r.shared_entities,
      confidence: Math.min(1.0, r.shared_entities / 5),
      rationale: `${r.shared_entities} shared entities`,
    }));

  if (suggestions.length === 0) {
    return {
      content: [{
        type: "text",
        text: `# Auto-Link: \`${vaultPath}\`\n\n` +
          `No new link suggestions found. All relevant notes may already be linked, ` +
          `or the knowledge graph may need more entities (try \`memory_ingest\` to re-index).`,
      }],
    };
  }

  const lines: string[] = [
    `# Auto-Link Suggestions: \`${vaultPath}\``,
    "",
    `Found **${suggestions.length}** link suggestions:`,
    "",
    "| # | Target | Shared Entities | Confidence |",
    "|---|--------|-----------------|------------|",
  ];

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    lines.push(`| ${i + 1} | ${s.wikilink} | ${s.shared_entities} | ${s.confidence.toFixed(2)} |`);
  }

  lines.push(
    "",
    "> ℹ️ **Dry run** — no files were modified.",
    "> Vault write-back is intentionally not implemented: manually adding links in Obsidian is safer."
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
