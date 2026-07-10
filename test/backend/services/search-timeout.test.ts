import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb } from "../../../src/backend/db";
import { SearchService } from "../../../src/backend/services/search";
import type Database from "bun:sqlite";

function unitVec(dim: number, idx: number): Buffer {
  const a = new Float32Array(dim);
  a[idx] = 1;
  return Buffer.from(a.buffer);
}

describe("SearchService LLM timeout fallback", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-search-to-"));
    db = initDb(join(dir, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });
  afterEach(() => cleanup());

  test("falls back to direct vector search when parseSearchQuery never resolves", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels)
       VALUES ('e1','t','a@x','invoice',1,'[]','[]')`
    );
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", unitVec(1024, 0)]);

    // LLM that hangs forever (proxy unavailable)
    const hangingLlm = { parseSearchQuery: () => new Promise(() => {}) } as any;
    // Query vector matches e1's embedding
    const embed = {
      embedQuery: async () => {
        const a = new Array(1024).fill(0);
        a[0] = 1;
        return a;
      },
    } as any;

    const svc = new SearchService(db, embed, hangingLlm, { llmParseTimeoutMs: 300 });

    // Bound the wait so a missing timeout impl fails the test instead of hanging the suite
    const settled = await Promise.race([
      svc.search("invoice").then((r) => ({ ok: true as const, r })),
      new Promise<{ ok: false }>((res) => setTimeout(() => res({ ok: false }), 2000)),
    ]);

    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.r.length).toBeGreaterThan(0);
      expect(settled.r[0].id).toBe("e1");
    }
  });
});
