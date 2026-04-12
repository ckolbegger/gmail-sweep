import Database from "bun:sqlite";
import { SCHEMA, VEC_SCHEMA } from "./schema";
import { loadVecExtension } from "./vec-loader";

function runMigrations(db: Database): void {
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "removed_state")) {
    db.run("ALTER TABLE emails ADD COLUMN removed_state TEXT DEFAULT NULL");
  }
  migrateEmbeddingsToVec0(db);
}

function migrateEmbeddingsToVec0(db: Database): void {
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "embedding")) return; // already migrated

  // Existing BLOBs were written as Float32Array by the worker but decoded
  // as Float64Array in search — all prior embeddings are unreliable. Drop,
  // do not copy, so the background worker re-embeds on next run.
  db.run("ALTER TABLE emails DROP COLUMN embedding");
  db.run("ALTER TABLE emails DROP COLUMN embedding_model");
  db.run("ALTER TABLE emails DROP COLUMN embedding_generated_at");
}

export function initDb(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA foreign_keys=ON;");
  loadVecExtension(db);
  db.exec(SCHEMA);
  db.exec(VEC_SCHEMA);
  runMigrations(db);
  return db;
}
