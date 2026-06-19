/**
 * Cache anchor utilities — ported from src/lib/common.sh check_cache_anchor().
 * Ensures the memory-index.md cache anchor line is intact.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { logger } from "./logger.js";

export interface CacheAnchorResult {
  valid: boolean;
  anchorVersion: string;
  missing: boolean;
  error?: string;
}

/**
 * Verify the cache anchor exists in memory-index.md.
 * The anchor is an HTML comment: <!-- CACHE_ANCHOR: memory-index-v1 -->
 */
export function checkCacheAnchor(vaultPath?: string): CacheAnchorResult {
  const vault = vaultPath || config.primaryVault;
  const indexPath = join(vault, config.memoryIndexFile);

  try {
    const content = readFileSync(indexPath, "utf-8");
    const anchor = `CACHE_ANCHOR: ${config.cacheAnchor}`;

    if (content.includes(anchor)) {
      return { valid: true, anchorVersion: config.cacheAnchor, missing: false };
    }

    const msg = `Cache anchor '${anchor}' missing from memory-index.md`;
    logger.error(msg);
    return {
      valid: false,
      anchorVersion: config.cacheAnchor,
      missing: true,
      error: msg,
    };
  } catch (err) {
    const msg = `Cannot read memory-index.md: ${err}`;
    logger.error(msg);
    return {
      valid: false,
      anchorVersion: config.cacheAnchor,
      missing: true,
      error: msg,
    };
  }
}

/**
 * Verify anchor from pre-read content (avoids re-reading the file).
 */
export function validateCacheAnchorInContent(content: string): CacheAnchorResult {
  const anchor = `CACHE_ANCHOR: ${config.cacheAnchor}`;
  if (content.includes(anchor)) {
    return { valid: true, anchorVersion: config.cacheAnchor, missing: false };
  }
  return {
    valid: false,
    anchorVersion: config.cacheAnchor,
    missing: true,
    error: `Cache anchor '${anchor}' not found in provided content`,
  };
}
