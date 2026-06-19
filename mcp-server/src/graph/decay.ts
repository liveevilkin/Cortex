/**
 * Ebbinghaus decay system — ported from src/lib/strength-calc.sh.
 *
 * Applies the Ebbinghaus forgetting curve to memory nodes:
 *   strength(t) = strength_0 * e^(-days / halfLife)
 *
 * Half-life defaults to 14 days. Memories below threshold are flagged
 * for archival or deletion.
 */
import { queryAll, execute, saveDatabase } from "../db/sqlite.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface DecayResult {
  filesProcessed: number;
  filesStrengthened: number;
  filesWeakened: number;
  archiveCandidates: Array<{
    vaultPath: string;
    strength: number;
    daysSinceReinforced: number;
    recommendation: "archive" | "review" | "keep";
  }>;
  deletionCandidates: Array<{
    vaultPath: string;
    strength: number;
    recommendation: "delete" | "review";
  }>;
}

/**
 * Calculate decayed strength using Ebbinghaus formula.
 */
export function calcDecayedStrength(
  lastReinforced: string,
  currentStrength: number,
  halfLifeDays: number = config.halfLifeDays
): number {
  if (!lastReinforced) return currentStrength;

  const lastDate = new Date(lastReinforced);
  const now = new Date();
  const days = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

  if (days <= 0) return currentStrength;

  // Ebbinghaus: strength * e^(-days/halfLife)
  const decayed = currentStrength * Math.exp(-days / halfLifeDays);
  return Math.max(0, Math.round(decayed * 100) / 100);
}

/**
 * Apply decay to all memory nodes.
 * Returns a result with archive/deletion candidates.
 */
export function applyDecayAll(
  halfLifeDays: number = config.halfLifeDays,
  archiveThreshold: number = config.archiveThreshold,
  deleteThreshold: number = config.deleteThreshold
): DecayResult {
  const nodes = queryAll<{
    vault_path: string;
    strength: number;
    last_reinforced: string;
  }>(
    "SELECT vault_path, strength, last_reinforced FROM memory_nodes WHERE status = 'active'"
  );

  const result: DecayResult = {
    filesProcessed: nodes.length,
    filesStrengthened: 0,
    filesWeakened: 0,
    archiveCandidates: [],
    deletionCandidates: [],
  };

  const today = new Date().toISOString().slice(0, 10);

  for (const node of nodes) {
    const newStrength = calcDecayedStrength(
      node.last_reinforced || today,
      node.strength,
      halfLifeDays
    );

    if (newStrength < node.strength) {
      result.filesWeakened++;
    } else {
      result.filesStrengthened++;
    }

    // Update strength in database
    execute(
      "UPDATE memory_nodes SET strength = ? WHERE vault_path = ?",
      [newStrength, node.vault_path]
    );

    // Check thresholds
    if (newStrength <= deleteThreshold) {
      result.deletionCandidates.push({
        vaultPath: node.vault_path,
        strength: newStrength,
        recommendation: "delete",
      });
    } else if (newStrength <= archiveThreshold) {
      const lastDate = new Date(node.last_reinforced || today);
      const daysSince = Math.round(
        (new Date().getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      result.archiveCandidates.push({
        vaultPath: node.vault_path,
        strength: newStrength,
        daysSinceReinforced: daysSince,
        recommendation: "archive",
      });
    }
  }

  // Sort candidates by strength (weakest first)
  result.archiveCandidates.sort((a, b) => a.strength - b.strength);
  result.deletionCandidates.sort((a, b) => a.strength - b.strength);

  logger.info(
    `Decay applied: ${result.filesWeakened} weakened, ` +
    `${result.archiveCandidates.length} archive candidates, ` +
    `${result.deletionCandidates.length} deletion candidates`
  );

  return result;
}

/**
 * Reinforce a memory (increase its strength).
 */
export function reinforceMemory(
  vaultPath: string,
  bonus: number = config.reinforceBonus
): number {
  const row = queryAll<{ strength: number }>(
    "SELECT strength FROM memory_nodes WHERE vault_path = ?",
    [vaultPath]
  );

  if (row.length === 0) return 0;

  const newStrength = Math.min(1.0, row[0].strength + bonus);
  const today = new Date().toISOString().slice(0, 10);

  execute(
    `UPDATE memory_nodes SET
      strength = ?, last_reinforced = ?,
      reinforced_count = reinforced_count + 1
     WHERE vault_path = ?`,
    [newStrength, today, vaultPath]
  );

  logger.debug(`Reinforced ${vaultPath}: ${row[0].strength.toFixed(2)} → ${newStrength.toFixed(2)}`);
  return newStrength;
}
