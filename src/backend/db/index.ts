import Database from "bun:sqlite";
import { SCHEMA } from "./schema";

export function initDb(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA);
  return db;
}
