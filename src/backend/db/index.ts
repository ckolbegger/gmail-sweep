import Database from "bun:sqlite";
import { SCHEMA, VEC_SCHEMA } from "./schema";
import { loadVecExtension } from "./vec-loader";

function runMigrations(db: Database): void {
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "removed_state")) {
    db.run("ALTER TABLE emails ADD COLUMN removed_state TEXT DEFAULT NULL");
  }
  // Restore embedding columns if a prior destructive migration removed them.
  if (!cols.some((c) => c.name === "embedding")) {
    db.run("ALTER TABLE emails ADD COLUMN embedding BLOB");
  }
  if (!cols.some((c) => c.name === "embedding_model")) {
    db.run("ALTER TABLE emails ADD COLUMN embedding_model TEXT");
  }
  if (!cols.some((c) => c.name === "embedding_generated_at")) {
    db.run("ALTER TABLE emails ADD COLUMN embedding_generated_at INTEGER");
  }
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
