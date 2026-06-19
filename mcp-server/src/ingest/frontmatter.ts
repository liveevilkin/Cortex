/**
 * YAML frontmatter parser for Obsidian markdown files.
 * Extracts metadata from --- delimited YAML blocks at the top of files.
 */
import * as yaml from "js-yaml";
import { logger } from "../utils/logger.js";

export interface FrontmatterData {
  // Common fields across all file types
  date?: string;
  tags?: string[];
  summary?: string;
  title?: string;
  strength?: number;
  last_reinforced?: string;
  reinforced_count?: number;
  decay_curve?: string;
  created?: string;
  updated?: string;
  version?: string;
  status?: string;
  cache_anchor?: string;

  // Daily-specific
  files_changed?: string[];

  // Links
  links?: string[];
  contradictions?: string[];

  // MCP-added (may not exist yet)
  mcp_entities?: Array<{ name: string; type: string }>;

  // Raw catch-all for any other fields
  [key: string]: unknown;
}

/**
 * Parse frontmatter from raw markdown content.
 * Returns { frontmatter, bodyStart, bodyEnd }.
 * bodyStart is the character index where the body content begins.
 */
export function parseFrontmatter(content: string): {
  frontmatter: FrontmatterData;
  bodyStart: number;
} {
  // Match --- ... --- at the start of the file
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

  if (!match) {
    return { frontmatter: {}, bodyStart: 0 };
  }

  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    const frontmatter: FrontmatterData = {};

    // Normalize known fields
    // Normalize dates: YAML parser may return Date objects for YYYY-MM-DD
    const asString = (v: unknown): string => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "string" || typeof v === "number") return String(v);
      return "";
    };

    if (parsed.date) frontmatter.date = asString(parsed.date);
    if (Array.isArray(parsed.tags)) {
      frontmatter.tags = parsed.tags.map(String);
    }
    if (typeof parsed.summary === "string") frontmatter.summary = parsed.summary;
    if (typeof parsed.title === "string") frontmatter.title = parsed.title;
    if (typeof parsed.strength === "number") frontmatter.strength = parsed.strength;
    if (parsed.last_reinforced !== undefined && parsed.last_reinforced !== null) frontmatter.last_reinforced = asString(parsed.last_reinforced);
    if (typeof parsed.reinforced_count === "number") frontmatter.reinforced_count = parsed.reinforced_count;
    if (typeof parsed.decay_curve === "string") frontmatter.decay_curve = parsed.decay_curve;
    if (parsed.created) frontmatter.created = asString(parsed.created);
    if (parsed.updated) frontmatter.updated = asString(parsed.updated);
    if (typeof parsed.version === "string") frontmatter.version = parsed.version;
    if (typeof parsed.status === "string") frontmatter.status = parsed.status;
    if (typeof parsed.cache_anchor === "string") frontmatter.cache_anchor = parsed.cache_anchor;
    if (Array.isArray(parsed.files_changed)) {
      frontmatter.files_changed = parsed.files_changed.map(String);
    }
    if (Array.isArray(parsed.links)) {
      frontmatter.links = parsed.links.map(String);
    }
    if (Array.isArray(parsed.contradictions)) {
      frontmatter.contradictions = parsed.contradictions.map(String);
    }
    if (Array.isArray(parsed.mcp_entities)) {
      frontmatter.mcp_entities = parsed.mcp_entities as Array<{ name: string; type: string }>;
    }

    // Merge raw fields without overwriting already-normalized values
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in frontmatter) || frontmatter[key as keyof FrontmatterData] === undefined) {
        (frontmatter as Record<string, unknown>)[key] = value;
      }
    }

    const bodyStart = (match[0] || "").length;

    return { frontmatter, bodyStart };
  } catch (err) {
    logger.warn(`Failed to parse frontmatter YAML: ${err}`);
    return { frontmatter: {}, bodyStart: match[0]?.length || 0 };
  }
}

/**
 * Extract date from frontmatter or filename.
 */
export function extractDate(frontmatter: FrontmatterData, filename: string): string {
  // Prefer frontmatter date
  if (frontmatter.date) {
    // Normalize: "2026-06-19" or "2026-06-19T..."
    const dateStr = String(frontmatter.date);
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  // Fall back to filename pattern: YYYY-MM-DD.md
  const fileMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (fileMatch) return fileMatch[1];

  // Fall back to created date
  if (frontmatter.created) {
    const match = String(frontmatter.created).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Determine file type from path and frontmatter.
 */
export function determineFileType(
  vaultPath: string,
  frontmatter: FrontmatterData
): "daily" | "decision" | "moc" | "knowledge" | "template" | "conflict" | "metric" {
  if (vaultPath.includes("/daily/") || vaultPath.startsWith("daily/")) return "daily";
  if (vaultPath.includes("/decisions/") || vaultPath.startsWith("decisions/")) return "decision";
  if (vaultPath.includes("/moc/") || vaultPath.startsWith("moc/")) return "moc";
  if (vaultPath.includes("/conflicts/") || vaultPath.startsWith("conflicts/")) return "conflict";
  if (vaultPath.includes("/metrics/") || vaultPath.startsWith("metrics/")) return "metric";
  if (vaultPath.includes("/templates/") || vaultPath.startsWith("templates/")) return "template";
  // Everything else in additional vaults is "knowledge"
  if (frontmatter.tags?.some(t => t.includes("learning") || t.includes("学习"))) return "knowledge";
  return "knowledge";
}

/**
 * Generate a title from frontmatter or file path.
 */
export function extractTitle(frontmatter: FrontmatterData, vaultPath: string): string {
  if (frontmatter.title) return frontmatter.title;
  // Extract from filename
  const filename = vaultPath.split("/").pop() || vaultPath;
  return filename.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-?/, "");
}

/**
 * Serialize frontmatter back to YAML string.
 */
export function serializeFrontmatter(frontmatter: FrontmatterData): string {
  // Build a clean object with only non-empty fields
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      clean[key] = value;
    }
  }
  return `---\n${yaml.dump(clean, { lineWidth: 120 }).trim()}\n---\n`;
}
