import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb } from "../../../src/backend/db";
import { SearchService } from "../../../src/backend/services/search";
import type Database from "bun:sqlite";

function createVecBuf(dim: number, values: number[]): Buffer {
  const arr = new Float32Array(dim);
  for (let i = 0; i < Math.min(values.length, dim); i++) arr[i] = values[i];
  return Buffer.from(arr.buffer);
}

describe("SearchService with LLM parser", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-search-"));
    const dbPath = join(dir, "test.db");
    db = initDb(dbPath);
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });

  afterEach(() => {
    cleanup();
  });

  test("falls back to LLM SQL filter when operators absent", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels)
       VALUES ('e1','t','alice@x','hi',1,'[]','[]'),('e2','t','bob@x','bye',2,'[]','[]')`
    );

    const llm = {
      parseSearchQuery: async () => ({ filters: { sender: "alice" }, semanticQuery: "" }),
    } as any;
    const embed = {
      embedQuery: async () => new Array(1024).fill(0),
    } as any;

    const svc = new SearchService(db, embed, llm);
    const results = await svc.search("from alice");
    expect(results.map((r) => r.id)).toContain("e1");
    expect(results.map((r) => r.id)).not.toContain("e2");
  });

  test("uses vec0 KNN when LLM returns a semanticQuery and operator filters are absent", async () => {
    // Insert two emails with different vec embeddings
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels)
       VALUES ('e1','t','alice@x','invoice',1,'[]','[]'),('e2','t','bob@x','party',2,'[]','[]')`
    );
    // e1 embedding points strongly in one direction
    const vec1 = createVecBuf(1024, [1, 0, 0, 0]);
    const vec2 = createVecBuf(1024, [0, 1, 0, 0]);
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", vec1]);
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e2", vec2]);

    const llm = {
      parseSearchQuery: async () => ({ filters: {}, semanticQuery: "invoice" }),
    } as any;
    // Query vector points same direction as e1
    const embed = {
      embedQuery: async () => new Array(1024).fill(0).map((_, i) => i === 0 ? 1 : 0),
    } as any;

    const svc = new SearchService(db, embed, llm);
    const results = await svc.search("invoice");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("e1");
  });

  test("operator-based search still works when operators present", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels, is_read)
       VALUES ('e1','t','alice@x','hi',1,'[]','[]',0),('e2','t','bob@x','bye',2,'[]','[]',1)`
    );

    // No LLM provider — operators should work without it
    const svc = new SearchService(db);
    const results = await svc.search("is:unread");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("e1");
  });

  test("pure SQL free-text search still works without LLM", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels)
       VALUES ('e1','t','alice@x','meeting tomorrow',1,'[]','[]'),('e2','t','bob@x','party invite',2,'[]','[]')`
    );

    const svc = new SearchService(db);
    const results = await svc.search("meeting");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("e1");
  });

  test("falls back to SQL when LLM parseSearchQuery throws", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels)
       VALUES ('e1','t','alice@x','meeting tomorrow',1,'[]','[]'),('e2','t','bob@x','party invite',2,'[]','[]')`
    );

    const llm = {
      parseSearchQuery: async () => { throw new Error("network timeout"); },
    } as any;

    const svc = new SearchService(db, undefined, llm);
    const results = await svc.search("meeting");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("e1");
  });
});
