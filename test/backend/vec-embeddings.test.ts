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
