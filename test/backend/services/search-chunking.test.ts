import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb } from "../../../src/backend/db";
import { EmbeddingWorker } from "../../../src/backend/services/embedding-worker";
import { SearchService } from "../../../src/backend/services/search";
import type Database from "bun:sqlite";

const DIM = 1024;

// Deterministic stand-in embedder: each keyword maps to a unique basis vector,
// so a query for a keyword lands nearest the chunk that contains it.
const KEYWORDS = ["alpha", "beta", "gamma"];
function textToVec(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const lower = text.toLowerCase();
  KEYWORDS.forEach((kw, i) => {
    if (lower.includes(kw)) v[i] = 1;
  });
  return v;
}

function unitBuf(idx: number): Buffer {
  const a = new Float32Array(DIM);
  a[idx] = 1;
  return Buffer.from(a.buffer);
}

describe("vector search over chunked emails", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-search-chunk-"));
    db = initDb(join(dir, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });
  afterEach(() => cleanup());

  test("collapses multiple chunks of one email to a single best-scored result", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, date_received, recipients, labels)
       VALUES ('e1','t','a','s','b',1,'[]','[]')`
    );
    // Three chunk rows for the SAME email at different similarities to the query.
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", unitBuf(0)]); // identical -> dist 0
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", unitBuf(1)]); // orthogonal -> dist 1
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", unitBuf(2)]); // orthogonal -> dist 1

    const provider = {
      embedQuery: async () => textToVec("alpha"),
      embedDocument: async () => new Array(DIM).fill(0),
    };
    const svc = new SearchService(db, provider as any);

    const results = await svc.search("alpha");

    expect(results.length).toBe(1); // deduped to one email
    expect(results[0].id).toBe("e1");
    // Score must come from the BEST chunk (dist 0 -> score 1), not a farther one.
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  test("a topic buried in the last chunk is still retrievable end-to-end", async () => {
    // Neutral subject so it doesn't match every chunk; body has one keyword per
    // ~600-char paragraph, so each paragraph becomes its own chunk.
    const para = (kw: string) => `${kw} ${"x".repeat(598 - kw.length)}`;
    const body = `${para("alpha")}\n\n${para("beta")}\n\n${para("gamma")}`;
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, date_received, recipients, labels, ai_status)
       VALUES ('e1','t','a','Msg',?,1,'[]','[]','done')`,
      [body]
    );

    const provider = {
      embedDocument: async (t: string) => textToVec(t),
      embedQuery: async (t: string) => textToVec(t),
    };
    const strategy = { type: "template" as const, template: "{{subject}} {{body_text}}" };

    const worker = new EmbeddingWorker(db, provider as any, strategy, DIM);
    const embedded = await worker.processPending();
    expect(embedded.processed).toBe(1);

    const chunkRows = (db.query("SELECT COUNT(*) c FROM vec_embeddings WHERE email_id = ?").get("e1") as any).c;
    expect(chunkRows).toBe(3); // sanity: it really chunked

    // "gamma" lives only in the LAST chunk — prove it's reachable.
    const svc = new SearchService(db, provider as any);
    const results = await svc.search("gamma");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("e1");
    expect(results[0].score).toBeGreaterThan(0.99);
  });
});
