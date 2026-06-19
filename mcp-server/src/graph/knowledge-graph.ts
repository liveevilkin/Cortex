/**
 * Knowledge graph operations — entity/relationship upsert, graph traversal,
 * Hebbian edge strengthening, and co-occurrence detection.
 */
import { getDb, queryAll, queryOne, execute, lastInsertRowId } from "../db/sqlite.js";
import { logger } from "../utils/logger.js";
import type { ExtractedEntity, EntityType } from "../ingest/entity-extractor.js";

// ── Entity operations ────────────────────────────────

export interface EntityRow {
  id: number;
  name: string;
  type: EntityType;
  description: string;
  aliases: string;
  first_seen_date: string;
  last_seen_date: string;
  occurrence_count: number;
  source_vault_paths: string;
  strength: number;
}

export interface RelationshipRow {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  source_name?: string;
  target_name?: string;
  relation_type: string;
  weight: number;
  co_activation_count: number;
  source_note: string;
  context_snippet: string;
}

/**
 * Upsert a single entity into the database.
 * Returns the entity ID.
 */
export function upsertEntity(
  entity: ExtractedEntity,
  sourceVaultPath: string,
  today: string
): number {
  const db = getDb();

  // Check if entity exists
  const existing = queryOne<{ id: number; occurrence_count: number; strength: number }>(
    "SELECT id, occurrence_count, strength FROM entities WHERE name = ?",
    [entity.name]
  );

  if (existing) {
    // Update existing entity
    const newCount = existing.occurrence_count + entity.mentions.length;
    const newStrength = Math.min(1.0, existing.strength + 0.05);

    // Update source paths
    const existingPaths = queryOne<{ source_vault_paths: string }>(
      "SELECT source_vault_paths FROM entities WHERE id = ?",
      [existing.id]
    );
    const paths = new Set((existingPaths?.source_vault_paths || "").split(",").filter(Boolean));
    paths.add(sourceVaultPath);

    execute(
      `UPDATE entities SET
        last_seen_date = ?, occurrence_count = ?, strength = ?,
        source_vault_paths = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [today, newCount, newStrength, [...paths].join(","), existing.id]
    );

    return existing.id;
  }

  // Insert new entity
  execute(
    `INSERT INTO entities (name, type, description, aliases, first_seen_date, last_seen_date,
      occurrence_count, source_vault_paths, strength)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entity.name,
      entity.type,
      "",
      entity.aliases.join(","),
      today,
      today,
      entity.mentions.length || 1,
      sourceVaultPath,
      0.5, // initial strength for new entity
    ]
  );

  return lastInsertRowId();
}

/**
 * Upsert a relationship between two entities.
 * Uses Hebbian learning: co_activation_count increases, weight strengthens.
 */
export function upsertRelationship(
  sourceId: number,
  targetId: number,
  relationType: string,
  sourceNote: string,
  contextSnippet: string = "",
  confidence: number = 0.5,
  today: string
): void {
  if (sourceId === targetId) return;

  // Ensure consistent ordering for co_occurs_with
  let src = sourceId;
  let tgt = targetId;
  if (relationType === "co_occurs_with" && src > tgt) {
    [src, tgt] = [tgt, src];
  }

  const existing = queryOne<{ id: number; weight: number; co_activation_count: number }>(
    `SELECT id, weight, co_activation_count FROM relationships
     WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ?`,
    [src, tgt, relationType]
  );

  if (existing) {
    // Hebbian strengthening: weight moves toward 1.0
    const learningRate = 0.1;
    const newWeight = existing.weight + learningRate * (1 - existing.weight);
    const newConfidence = Math.min(1.0, confidence + 0.05);

    execute(
      `UPDATE relationships SET
        weight = ?, co_activation_count = ?, last_seen_date = ?,
        confidence = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [newWeight, existing.co_activation_count + 1, today, newConfidence, existing.id]
    );
  } else {
    execute(
      `INSERT INTO relationships
        (source_entity_id, target_entity_id, relation_type, weight,
         co_activation_count, first_seen_date, last_seen_date,
         source_note, context_snippet, confidence)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [src, tgt, relationType, 0.5, today, today, sourceNote, contextSnippet, confidence]
    );
  }
}

/**
 * Detect all co-occurrence relationships from a list of entity IDs found in the same chunk.
 */
export function detectCoOccurrences(
  entityIds: number[],
  sourceNote: string,
  contextSnippet: string,
  today: string
): number {
  let count = 0;
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      upsertRelationship(entityIds[i], entityIds[j], "co_occurs_with", sourceNote, contextSnippet, 0.5, today);
      count++;
    }
  }
  return count;
}

/**
 * Link entity to a memory node.
 */
export function linkEntityToNode(entityId: number, nodeId: number, mentionCount: number = 1): void {
  execute(
    `INSERT OR REPLACE INTO node_entities (node_id, entity_id, mention_count)
     VALUES (?, ?, COALESCE(
       (SELECT mention_count + ? FROM node_entities WHERE node_id = ? AND entity_id = ?),
       ?
     ))`,
    [nodeId, entityId, mentionCount, nodeId, entityId, mentionCount]
  );
}

// ── Graph traversal ───────────────────────────────────

export interface GraphQueryResult {
  entity: EntityRow;
  relationships: RelationshipRow[];
  connectedMemories: Array<{ vault_path: string; title: string; file_type: string }>;
  graphStats: {
    totalEntities: number;
    totalRelationships: number;
    totalMemoryNodes: number;
  };
}

/**
 * Query the knowledge graph starting from an entity name.
 * Traverses up to the specified depth.
 */
export function queryGraph(
  entityName: string,
  relationType: string = "all",
  traverseDepth: number = 1,
  minEdgeWeight: number = 0.1,
  limit: number = 20
): GraphQueryResult | null {
  // Find the entity
  const entity = queryOne<EntityRow>(
    "SELECT * FROM entities WHERE name LIKE ? LIMIT 1",
    [`%${entityName}%`]
  );
  if (!entity) return null;

  // Get relationships with optional multi-hop traversal
  const relationships: RelationshipRow[] = [];
  const visitedEntities = new Set<number>([entity.id]);
  let currentFrontier = new Set<number>([entity.id]);

  for (let hop = 0; hop < traverseDepth; hop++) {
    if (currentFrontier.size === 0) break;

    const nextFrontier = new Set<number>();
    for (const srcId of currentFrontier) {
      let relSql: string;
      const relParams: unknown[] = [];

      if (relationType === "all") {
        relSql = `
          SELECT r.*, e1.name as source_name, e2.name as target_name
          FROM relationships r
          JOIN entities e1 ON r.source_entity_id = e1.id
          JOIN entities e2 ON r.target_entity_id = e2.id
          WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
            AND r.weight >= ?
          ORDER BY r.weight DESC
          LIMIT ?`;
        relParams.push(srcId, srcId, minEdgeWeight, limit);
      } else {
        relSql = `
          SELECT r.*, e1.name as source_name, e2.name as target_name
          FROM relationships r
          JOIN entities e1 ON r.source_entity_id = e1.id
          JOIN entities e2 ON r.target_entity_id = e2.id
          WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
            AND r.relation_type = ? AND r.weight >= ?
          ORDER BY r.weight DESC
          LIMIT ?`;
        relParams.push(srcId, srcId, relationType, minEdgeWeight, limit);
      }

      const hopResults = queryAll<RelationshipRow>(relSql, relParams);
      for (const r of hopResults) {
        const otherId = r.source_entity_id === srcId ? r.target_entity_id : r.source_entity_id;
        if (!visitedEntities.has(otherId)) {
          visitedEntities.add(otherId);
          nextFrontier.add(otherId);
        }
        relationships.push(r);
      }
    }
    currentFrontier = nextFrontier;
  }

  // Get connected memory nodes
  const memories = queryAll<{ vault_path: string; title: string; file_type: string }>(
    `SELECT DISTINCT m.vault_path, m.title, m.file_type
     FROM memory_nodes m
     JOIN node_entities ne ON m.id = ne.node_id
     WHERE ne.entity_id = ?
     LIMIT 10`,
    [entity.id]
  );

  // Stats
  const totalEntities = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM entities")?.cnt || 0;
  const totalRels = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM relationships")?.cnt || 0;
  const totalNodes = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM memory_nodes")?.cnt || 0;

  return {
    entity,
    relationships,
    connectedMemories: memories,
    graphStats: { totalEntities, totalRelationships: totalRels, totalMemoryNodes: totalNodes },
  };
}

/**
 * Get top entities ranked by strength.
 */
export function getTopEntities(limit: number = 10): EntityRow[] {
  return queryAll<EntityRow>(
    "SELECT * FROM entities ORDER BY strength DESC LIMIT ?",
    [limit]
  );
}

/**
 * Find memory nodes that share entities with a given node.
 */
export function findRelatedNodes(
  nodeId: number,
  limit: number = 10
): Array<{
  vault_path: string;
  title: string;
  shared_entities: number;
  semantic_similarity: number;
}> {
  return queryAll(
    `SELECT
       m.vault_path, m.title,
       COUNT(DISTINCT ne2.entity_id) as shared_entities,
       0.0 as semantic_similarity
     FROM memory_nodes m
     JOIN node_entities ne1 ON ne1.node_id = ?
     JOIN node_entities ne2 ON ne2.entity_id = ne1.entity_id
     WHERE m.id = ne2.node_id AND m.id != ?
     GROUP BY m.id
     ORDER BY shared_entities DESC
     LIMIT ?`,
    [nodeId, nodeId, limit]
  );
}

/**
 * Count entities by type.
 */
export function countEntitiesByType(): Record<string, number> {
  const rows = queryAll<{ type: string; cnt: number }>(
    "SELECT type, COUNT(*) as cnt FROM entities GROUP BY type"
  );
  const result: Record<string, number> = {};
  for (const r of rows) result[r.type] = r.cnt;
  return result;
}
