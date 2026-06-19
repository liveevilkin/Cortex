/**
 * Migration 001: Initial schema — all 8 tables.
 */
import type { Database as SqlJsDatabase } from "sql.js";
import { logger } from "../../utils/logger.js";

const SCHEMA_VERSION = 1;

export function runMigration(db: SqlJsDatabase): void {
  // Check if migration already applied
  let currentVersion = 0;
  try {
    const result = db.exec("SELECT value FROM index_metadata WHERE key = 'schema_version'");
    if (result.length > 0 && result[0].values.length > 0) {
      currentVersion = parseInt(String(result[0].values[0][0]), 10);
    }
  } catch {
    // Table doesn't exist yet — first run
  }

  if (currentVersion >= SCHEMA_VERSION) {
    logger.debug(`Schema at version ${currentVersion}, no migration needed`);
    return;
  }

  logger.info(`Running migration 001_initial (schema v${SCHEMA_VERSION})`);

  // ============================================================
  // Entities: extracted from vault content
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS entities (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL UNIQUE,
      type            TEXT NOT NULL CHECK(type IN (
                        'technology', 'concept', 'person',
                        'project', 'skill', 'company',
                        'tool', 'process', 'domain', 'other'
                      )),
      description     TEXT DEFAULT '',
      aliases         TEXT DEFAULT '',
      first_seen_date TEXT NOT NULL,
      last_seen_date  TEXT NOT NULL,
      occurrence_count INTEGER DEFAULT 1,
      source_vault_paths TEXT DEFAULT '',
      strength        REAL DEFAULT 0.5,
      embedding_id    TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_entities_strength ON entities(strength DESC)");

  // ============================================================
  // Relationships: typed edges between entities
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS relationships (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id    INTEGER NOT NULL,
      target_entity_id    INTEGER NOT NULL,
      relation_type       TEXT NOT NULL CHECK(relation_type IN (
                            'relates_to', 'contradicts', 'supersedes',
                            'depends_on', 'mentions', 'part_of',
                            'derives_from', 'co_occurs_with'
                          )),
      weight              REAL DEFAULT 0.5,
      co_activation_count INTEGER DEFAULT 1,
      first_seen_date     TEXT NOT NULL,
      last_seen_date      TEXT NOT NULL,
      source_note         TEXT NOT NULL,
      context_snippet     TEXT DEFAULT '',
      confidence          REAL DEFAULT 0.5,
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE(source_entity_id, target_entity_id, relation_type)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_rel_type   ON relationships(relation_type)");

  // ============================================================
  // Memory Nodes: mirrors vault markdown files
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_path      TEXT NOT NULL UNIQUE,
      title           TEXT DEFAULT '',
      file_type       TEXT NOT NULL CHECK(file_type IN (
                        'daily', 'decision', 'moc',
                        'knowledge', 'template', 'conflict', 'metric'
                      )),
      date            TEXT,
      strength        REAL DEFAULT 1.0,
      decay_half_life INTEGER DEFAULT 14,
      last_reinforced TEXT,
      reinforced_count INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'active' CHECK(status IN (
                        'active', 'archived', 'superseded', 'draft'
                      )),
      summary         TEXT DEFAULT '',
      tags            TEXT DEFAULT '',
      token_count     INTEGER DEFAULT 0,
      file_size_bytes INTEGER DEFAULT 0,
      file_mtime      TEXT NOT NULL,
      frontmatter_json TEXT DEFAULT '{}',
      embedding_chunk_ids TEXT DEFAULT '',
      last_indexed    TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_nodes_type    ON memory_nodes(file_type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_nodes_date    ON memory_nodes(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_nodes_strength ON memory_nodes(strength DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_nodes_path    ON memory_nodes(vault_path)");

  // ============================================================
  // Wikilinks: Obsidian [[wikilink]] connections
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS wikilinks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_node_id      INTEGER NOT NULL,
      target_node_id      INTEGER NOT NULL,
      link_text           TEXT DEFAULT '',
      context_snippet     TEXT DEFAULT '',
      is_auto_generated   INTEGER DEFAULT 0,
      confidence          REAL DEFAULT 1.0,
      created_at          TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
      UNIQUE(source_node_id, target_node_id)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source_node_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_node_id)");

  // ============================================================
  // Node-Entity bridge
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS node_entities (
      node_id     INTEGER NOT NULL,
      entity_id   INTEGER NOT NULL,
      mention_count INTEGER DEFAULT 1,
      PRIMARY KEY (node_id, entity_id),
      FOREIGN KEY (node_id)   REFERENCES memory_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_ne_node   ON node_entities(node_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ne_entity ON node_entities(entity_id)");

  // ============================================================
  // Knowledge Gaps
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_gaps (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      topic               TEXT NOT NULL,
      related_goal        TEXT DEFAULT '',
      related_goal_path   TEXT DEFAULT '',
      current_coverage    REAL DEFAULT 0.0,
      priority            TEXT DEFAULT 'medium' CHECK(priority IN (
                            'critical', 'high', 'medium', 'low'
                          )),
      suggested_resources TEXT DEFAULT '',
      prerequisite_topics TEXT DEFAULT '',
      detected_date       TEXT NOT NULL,
      resolved_date       TEXT,
      status              TEXT DEFAULT 'open' CHECK(status IN (
                            'open', 'in_progress', 'resolved'
                          ))
    )
  `);

  // ============================================================
  // Conversation Turns
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp           TEXT NOT NULL,
      session_id          TEXT DEFAULT '',
      topic               TEXT DEFAULT '',
      entities_mentioned  TEXT DEFAULT '[]',
      notes_referenced    TEXT DEFAULT '[]',
      summary             TEXT DEFAULT '',
      new_entities_count  INTEGER DEFAULT 0,
      contradictions_found INTEGER DEFAULT 0
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON conversation_turns(timestamp)");

  // ============================================================
  // Index Metadata: sync tracking
  // ============================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL
    )
  `);

  // Seed metadata
  const today = new Date().toISOString().slice(0, 10);
  db.run("INSERT OR REPLACE INTO index_metadata (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
  db.run("INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('last_full_ingest', '')");
  db.run("INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('total_ingests', '0')");
  db.run("INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('embedding_model', '')");
  db.run("INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('embedding_dimensions', '384')");

  logger.info("Migration 001_initial complete");
}
