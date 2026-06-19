/**
 * SQLite database layer using sql.js (WASM-based, no native compilation).
 * Provides an async API wrapping the synchronous sql.js interface.
 */
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { runMigration } from "./migrations/001_initial.js";

let SQL: SqlJsStatic | null = null;
let db: SqlJsDatabase | null = null;
let dbPath: string;

/**
 * Initialize the WASM SQLite module and open/create the database file.
 */
export async function initDatabase(dbFilePath?: string): Promise<void> {
  dbPath = dbFilePath || config.sqlitePath();

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logger.info(`Initializing SQLite database at ${dbPath}`);

  SQL = await initSqlJs();

  // Load existing database or create new
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    logger.info(`Loaded existing database (${buffer.length} bytes)`);
  } else {
    db = new SQL.Database();
    logger.info("Created new database");
  }

  // Enable foreign key enforcement (sql.js defaults to OFF)
  db.run("PRAGMA foreign_keys = ON");
  // Disable journaling for speed (we save manually via export)
  db.run("PRAGMA journal_mode=OFF");
  db.run("PRAGMA synchronous=OFF");

  // Run migrations
  runMigration(getDb());
}

/**
 * Get the current database instance.
 * Throws if not initialized.
 */
export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Get the SQL.js singleton for creating new databases.
 */
export function getSQL(): SqlJsStatic {
  if (!SQL) {
    throw new Error("SQL.js not initialized. Call initDatabase() first.");
  }
  return SQL;
}

/**
 * Save the database to disk.
 */
export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
  logger.debug(`Database saved to ${dbPath} (${buffer.length} bytes)`);
}

/**
 * Run a SQL statement with optional parameters.
 * Returns the database instance for chaining.
 */
export function run(sql: string, params?: unknown[]): SqlJsDatabase {
  const database = getDb();
  database.run(sql, params);
  return database;
}

/**
 * Execute a query and return all rows as objects.
 */
export function queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const database = getDb();
  const results: T[] = [];
  try {
    const stmt = database.prepare(sql);
    if (params) {
      stmt.bind(params);
    }
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as T;
      results.push(row);
    }
    stmt.free();
  } catch (err) {
    logger.error(`SQL query failed: ${sql}`, err);
    throw err;
  }
  return results;
}

/**
 * Execute a query and return the first row as an object, or null.
 */
export function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
  const database = getDb();
  try {
    const stmt = database.prepare(sql);
    if (params) {
      stmt.bind(params);
    }
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as T;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (err) {
    logger.error(`SQL query failed: ${sql}`, err);
    throw err;
  }
}

/**
 * Execute a write statement and return the number of changes.
 */
export function execute(sql: string, params?: unknown[]): number {
  const database = getDb();
  database.run(sql, params);
  const changes = database.getRowsModified();
  return changes;
}

/**
 * Get the last inserted row ID.
 */
export function lastInsertRowId(): number {
  const result = queryOne<{ id: number }>("SELECT last_insert_rowid() as id");
  return result?.id ?? 0;
}

/**
 * Close the database (saves first).
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    logger.info("Database closed");
  }
}
