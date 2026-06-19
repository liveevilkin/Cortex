/**
 * LanceDB vector database layer.
 * Stores document chunk embeddings for semantic search.
 */
import * as lancedb from "@lancedb/lancedb";
import { type Connection, type Table } from "@lancedb/lancedb";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let connection: Connection | null = null;
let noteChunksTable: Table | null = null;

export interface NoteChunkRow {
  id: string;
  vault_path: string;
  node_id: number;
  chunk_index: number;
  chunk_text: string;
  heading_path: string;
  entities: string;
  tags: string;
  date: string;
  file_type: string;
  token_count: number;
  vector: number[];
}

/**
 * Initialize LanceDB connection and tables.
 */
export async function initLanceDB(dbPath?: string): Promise<void> {
  const path = dbPath || config.lancedbPath();
  logger.info(`Initializing LanceDB at ${path}`);

  connection = await lancedb.connect(path);

  const tableNames = await connection.tableNames();
  if (tableNames.includes("note_chunks")) {
    noteChunksTable = await connection.openTable("note_chunks");
    const count = await noteChunksTable.countRows();
    logger.info(`Opened existing note_chunks table (${count} rows)`);
  } else {
    logger.info("note_chunks table will be created on first ingest");
  }
}

export function getConnection(): Connection {
  if (!connection) {
    throw new Error("LanceDB not initialized. Call initLanceDB() first.");
  }
  return connection;
}

export async function getNoteChunksTable(): Promise<Table | null> {
  const conn = getConnection();
  if (!noteChunksTable) {
    const tableNames = await conn.tableNames();
    if (tableNames.includes("note_chunks")) {
      noteChunksTable = await conn.openTable("note_chunks");
    }
  }
  return noteChunksTable;
}

export async function createNoteChunksTable(initialData: NoteChunkRow[]): Promise<Table> {
  const conn = getConnection();
  const tableNames = await conn.tableNames();
  if (tableNames.includes("note_chunks")) {
    await conn.dropTable("note_chunks");
    logger.debug("Dropped existing note_chunks table for recreation");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  noteChunksTable = await conn.createTable("note_chunks", initialData as any);
  logger.info(`Created note_chunks table with ${initialData.length} initial rows`);
  return noteChunksTable;
}

export async function addChunks(chunks: NoteChunkRow[]): Promise<void> {
  const table = await getNoteChunksTable();
  if (!table) {
    await createNoteChunksTable(chunks);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await table.add(chunks as any);
  logger.debug(`Added ${chunks.length} chunks to note_chunks`);
}

export async function searchChunks(
  queryVector: number[],
  limit: number = config.defaultSearchResults
): Promise<Array<{ row: NoteChunkRow; score: number }>> {
  const table = await getNoteChunksTable();
  if (!table) {
    logger.warn("note_chunks table does not exist yet");
    return [];
  }

  const results = await table
    .search(queryVector)
    .limit(limit)
    .toArray();

  return results.map((r: unknown) => {
    const obj = r as Record<string, unknown>;
    return {
      row: obj as unknown as NoteChunkRow,
      score: obj._distance !== undefined ? 1 - Number(obj._distance) : 0,
    };
  });
}

export async function countChunks(): Promise<number> {
  try {
    const table = await getNoteChunksTable();
    if (!table) return 0;
    return await table.countRows();
  } catch {
    return 0;
  }
}

export async function deleteChunksForPath(vaultPath: string): Promise<void> {
  const table = await getNoteChunksTable();
  if (!table) return;
  await table.delete(`vault_path = '${vaultPath.replace(/'/g, "''")}'`);
  logger.debug(`Deleted chunks for ${vaultPath}`);
}

export async function getDbSize(): Promise<number> {
  try {
    const table = await getNoteChunksTable();
    if (!table) return 0;
    const count = await table.countRows();
    return count * 2048;
  } catch {
    return 0;
  }
}
