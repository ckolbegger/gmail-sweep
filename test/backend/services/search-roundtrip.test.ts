import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb } from "../../../src/backend/db";
import { EmbeddingWorker } from "../../../src/backend/services/embedding-worker";
import { SearchService } from "../../../src/backend/services/search";
import type Database from "bun:sqlite";

const DIM = 1024;
// Deterministic stand-in for a real embedder: each keyword maps to a unique
// basis vector, so a query containing the same keyword lands nearest that doc.
const KEYWORDS = ["invoice", "party", "meeting"];
function textToVec(text: string): number[] {
  const v = new Array(DIM).fill(0);
  const lower = text.toLowerCase();
  KEYWORDS.forEach((kw, i) => {
    if (lower.includes(kw)) v[i] = 1;
  });
  return v;
}

describe("vector search end-to-end (embed -> store -> query -> rank)", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-roundtrip-"));
    db = initDb(join(dir, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });
  afterEach(() => cleanup());

  test("returns the semantically matching email ranked first with a score", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, date_received, recipients, labels, ai_status)
       VALUES
         ('e1','t','a@x','Invoice for services','Please pay the attached invoice.',1,'[]','[]','done'),
         ('e2','t','b@x','Party invite','Come to my party on Friday.',2,'[]','[]','done'),
         ('e3','t','c@x','Team meeting','Sync meeting notes attached.',3,'[]','[]','done')`
    );

    const provider = {
      embedDocument: async (t: string) => textToVec(t),
      embedQuery: async (t: string) => textToVec(t),
    };
    const strategy = { type: "template" as const, template: "{{subject}} {{body_text}}" };

    // Embed all three via the worker (exercises embedDocument -> vec0 insert)
    const worker = new EmbeddingWorker(db, provider as any, strategy, DIM);
    const embedded = await worker.processPending();
    expect(embedded.processed).toBe(3);

    // No LLM provider -> raw query goes straight to vector search
    const svc = new SearchService(db, provider as any);
    const results = await svc.search("invoice");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("e1");
    expect(results[0].score).not.toBeNull();
    expect(results[0].score).toBeGreaterThan(0.99); // exact basis-vector match
  });
});
