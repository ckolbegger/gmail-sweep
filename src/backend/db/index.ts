import Database from "bun:sqlite";
import { SCHEMA } from "./schema";

function runMigrations(db: Database): void {
  // Check if removed_state column exists
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "removed_state")) {
    db.run("ALTER TABLE emails ADD COLUMN removed_state TEXT DEFAULT NULL");
  }
}

export function initDb(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}
