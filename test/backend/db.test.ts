import { describe, it, expect, afterEach } from "bun:test";
import Database from "bun:sqlite";
import { initDb } from "@backend/db";
import { createTestDb } from "@test/helpers/test-db";

describe("Database initialization", () => {
  let db: Database;
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it("should create the emails table on first run", () => {
    ({ db, cleanup } = createTestDb());
    const table = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='emails'"
      )
      .get();
    expect(table).not.toBeNull();
  });

  it("should not fail if tables already exist (idempotent)", () => {
    ({ db, cleanup } = createTestDb());
    // initDb already ran in createTestDb, run again
    const dbPath = (db as any)._path;
    expect(() => initDb(dbPath)).not.toThrow();
  });

  it("should create indexes on date_received, is_read, and thread_id", () => {
    ({ db, cleanup } = createTestDb());
    const indexes = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_emails_%'"
      )
      .all()
      .map((r: any) => r.name);
    expect(indexes).toContain("idx_emails_date_received");
    expect(indexes).toContain("idx_emails_is_read");
    expect(indexes).toContain("idx_emails_thread_id");
  });
});
