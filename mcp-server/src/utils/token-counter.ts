/**
 * Token estimation utilities.
 * Rough estimate: 1 token ≈ 4 characters (works for both English and Chinese).
 * Ported from src/lib/common.sh estimate_tokens().
 */

export function estimateTokens(text: string): number {
  // Count characters (not bytes) for CJK compatibility
  return Math.ceil([...text].length / 4);
}

/**
 * Check if content exceeds a token budget.
 * Returns { ok: boolean, tokens: number }.
 */
export function checkTokenBudget(text: string, maxTokens: number): { ok: boolean; tokens: number } {
  const tokens = estimateTokens(text);
  return { ok: tokens <= maxTokens, tokens };
}

/**
 * Estimate tokens for a file path. Reads the file and counts.
 */
export function estimateFileTokens(filePath: string): number {
  const fs = require("node:fs");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return estimateTokens(content);
  } catch {
    return 0;
  }
}

/**
 * Truncate text to fit within a token budget, preserving word boundaries.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const chars = [...text];
  const maxChars = maxTokens * 4;
  if (chars.length <= maxChars) return text;
  // Try to break at the last newline or space before the limit
  const truncated = chars.slice(0, maxChars).join("");
  const lastBreak = Math.max(
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(" "),
    truncated.lastIndexOf("。"),
    truncated.lastIndexOf("，")
  );
  if (lastBreak > maxChars * 0.7) {
    return truncated.slice(0, lastBreak) + "…";
  }
  return truncated + "…";
}
