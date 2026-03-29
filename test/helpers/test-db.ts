import Database from "bun:sqlite";
import { initDb } from "@backend/db";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createTestDb(): { db: Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-test-"));
  const dbPath = join(dir, "test.db");
  const db = initDb(dbPath);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
