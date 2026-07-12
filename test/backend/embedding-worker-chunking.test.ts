import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { EmbeddingWorker } from "@backend/services/embedding-worker";
import { initDb } from "@backend/db";
import type Database from "bun:sqlite";
import type { EmbedProvider } from "@backend/services/embed-provider";
import type { ExtractionStrategy } from "@shared/types";

const strategy: ExtractionStrategy = { type: "template", template: "{{subject}} {{body_text}}" };

// Three ~600-char paragraphs -> three chunks (any pair exceeds the 1000-char cap).
function multiChunkBody(): string {
  const para = (kw: string) => `${kw} ${"x".repeat(598 - kw.length)}`;
  return `${para("alpha")}\n\n${para("beta")}\n\n${para("gamma")}`;
}

const zeroVec = (): number[] => new Array(1024).fill(0.1);

describe("EmbeddingWorker chunking", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-ew-chunk-"));
    db = initDb(join(dir, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });
  afterEach(() => cleanup());

  function seedMultiChunkEmail(id: string, subject = "S"): void {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, ai_status)
       VALUES (?, 't', 'a@b.com', '[]', ?, ?, '', 1, 1, '[]', 0, 0, 0, 'done')`,
      [id, subject, multiChunkBody()]
    );
  }

  function rowsFor(id: string): any[] {
    return db.query("SELECT email_id FROM vec_embeddings WHERE email_id = ?").all(id);
  }

  it("stores one vec_embeddings row per chunk for a long multi-paragraph email", async () => {
    seedMultiChunkEmail("m1");
    const provider: EmbedProvider = {
      embedDocument: mock(async () => zeroVec()),
      embedQuery: mock(async () => zeroVec()),
    };
    const worker = new EmbeddingWorker(db, provider, strategy, 1024);
    const result = await worker.processPending();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(rowsFor("m1").length).toBe(3); // one row per chunk
  });

  it("counts processing per email, not per chunk", async () => {
    seedMultiChunkEmail("m1");
    seedMultiChunkEmail("m2");
    const provider: EmbedProvider = {
      embedDocument: mock(async () => zeroVec()),
      embedQuery: mock(async () => zeroVec()),
    };
    const worker = new EmbeddingWorker(db, provider, strategy, 1024);
    const result = await worker.processPending();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    const total = (db.query("SELECT COUNT(*) c FROM vec_embeddings").get() as any).c;
    expect(total).toBe(6); // 3 chunks x 2 emails
  });

  it("is atomic: a mid-chunk embedding error inserts zero rows for that email", async () => {
    seedMultiChunkEmail("m1"); // -> 3 chunks
    let call = 0;
    const provider: EmbedProvider = {
      embedDocument: mock(async () => {
        call++;
        if (call === 2) throw new Error("boom mid-email");
        return zeroVec();
      }),
      embedQuery: mock(async () => zeroVec()),
    };
    const worker = new EmbeddingWorker(db, provider, strategy, 1024);
    const result = await worker.processPending();

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(rowsFor("m1").length).toBe(0); // no partial insert
  });

  it("cancellation mid-email discards partial chunks (no rows inserted)", async () => {
    seedMultiChunkEmail("m1"); // -> 3 chunks
    let worker: EmbeddingWorker;
    let call = 0;
    const provider: EmbedProvider = {
      embedDocument: mock(async () => {
        call++;
        if (call === 2) worker.stop(); // cancel after the second chunk embeds
        return zeroVec();
      }),
      embedQuery: mock(async () => zeroVec()),
    };
    worker = new EmbeddingWorker(db, provider, strategy, 1024);
    const result = await worker.processPending();

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(rowsFor("m1").length).toBe(0); // discarded, never committed
  });
});
