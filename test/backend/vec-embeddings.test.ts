import { describe, test, expect } from "bun:test";
import Database from "bun:sqlite";
import { loadVecExtension } from "@backend/db/vec-loader";
import { initDb } from "@backend/db";

describe("vec-loader", () => {
  test("loads sqlite-vec extension into a bun:sqlite db", () => {
    const db = new Database(":memory:");
    loadVecExtension(db);
    const row = db.query("SELECT vec_version() AS v").get() as { v: string };
    expect(typeof row.v).toBe("string");
    expect(row.v.length).toBeGreaterThan(0);
  });
});

describe("vec_embeddings virtual table", () => {
  test("round-trip insert then MATCH returns ordered distances", () => {
    const db = initDb(":memory:");
    const dim = 4;
    // Drop the default 1024-dim table and recreate with 4-dim for testing
    db.run("DROP TABLE IF EXISTS vec_embeddings");
    db.run(
      `CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${dim}] distance_metric=cosine, +email_id TEXT)`
    );
    const toBuf = (v: number[]) => {
      const f = new Float32Array(v);
      return Buffer.from(f.buffer);
    };
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["a", toBuf([1, 0, 0, 0])]);
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["b", toBuf([0, 1, 0, 0])]);
    const rows = db
      .query("SELECT email_id, distance FROM vec_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance")
      .all(toBuf([1, 0, 0, 0]), 2) as Array<{ email_id: string; distance: number }>;
    expect(rows[0].email_id).toBe("a");
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
  });
});

describe("embedding column rollback migration", () => {
  test("re-adds embedding columns if a prior migration dropped them", () => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");

    // Create a database that ran the destructive Phase A: emails without embedding columns
    const dir = mkdtempSync(join(tmpdir(), "gs-rollback-"));
    const path = join(dir, "test.db");

    const db1 = new Database(path);
    loadVecExtension(db1);
    db1.exec(`
      CREATE TABLE emails (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        sender TEXT,
        recipients TEXT,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        date_sent INTEGER,
        date_received INTEGER,
        labels TEXT,
        is_read INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,
        fetched_at INTEGER,
        ai_status TEXT DEFAULT 'pending',
        summary TEXT,
        action_items TEXT,
        key_points TEXT,
        summary_model TEXT,
        summary_generated_at INTEGER,
        removed_state TEXT DEFAULT NULL
      )
    `);
    const colsBefore = db1.query("PRAGMA table_info(emails)").all() as { name: string }[];
    expect(colsBefore.some((c) => c.name === "embedding")).toBe(false);
    db1.close();

    // Run initDb (which includes the rollback migration)
    const db2 = initDb(path);
    const cols = db2.query("PRAGMA table_info(emails)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("embedding");
    expect(colNames).toContain("embedding_model");
    expect(colNames).toContain("embedding_generated_at");
    db2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
