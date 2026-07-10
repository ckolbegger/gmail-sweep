import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { EmbeddingWorker } from "@backend/services/embedding-worker";
import { initDb } from "@backend/db";
import type Database from "bun:sqlite";
import type { EmbedProvider } from "@backend/services/embed-provider";

const strategy = { type: "template" as const, template: "{{subject}} {{body_text}}" };

function seed(db: Database, n: number) {
  for (let i = 0; i < n; i++) {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, ai_status)
       VALUES (?, 't', 'a@b.com', '[]', ?, ?, '', 1, ?, '[]', 0, 0, 0, 'done')`,
      [`m${i}`, `subj ${i}`, `body ${i}`, i]
    );
  }
}

describe("EmbeddingWorker cancellation + yielding", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-ew-cancel-"));
    db = initDb(join(dir, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });
  afterEach(() => cleanup());

  it("stop() cancels an in-flight processPending so the server can respond", async () => {
    seed(db, 10);
    const provider: EmbedProvider = {
      embedDocument: mock(async () => new Array(1024).fill(0.1)),
      embedQuery: mock(async () => new Array(1024).fill(0.1)),
    };
    const worker = new EmbeddingWorker(db, provider, strategy, 1024, 2);

    worker.stop(); // set cancelled before processing
    const result = await worker.processPending();

    expect(result.processed).toBe(0);
    const embedded = (db.query("SELECT COUNT(*) c FROM vec_embeddings").get() as any).c;
    expect(embedded).toBe(0);
  });

  it("start() resets the cancel flag so processing resumes", async () => {
    seed(db, 3);
    const provider: EmbedProvider = {
      embedDocument: mock(async () => new Array(1024).fill(0.1)),
      embedQuery: mock(async () => new Array(1024).fill(0.1)),
    };
    const worker = new EmbeddingWorker(db, provider, strategy, 1024, 2);

    worker.stop();
    let result = await worker.processPending();
    expect(result.processed).toBe(0);

    worker.start(60_000); // resets cancelled
    await new Promise((r) => setTimeout(r, 150)); // let the immediate run finish
    worker.stop();
    const embedded = (db.query("SELECT COUNT(*) c FROM vec_embeddings").get() as any).c;
    expect(embedded).toBe(3);
  });

  it("yields to the event loop between embeds (HTTP server must stay responsive)", async () => {
    seed(db, 5);
    const provider: EmbedProvider = {
      embedDocument: mock(async () => new Array(1024).fill(0.1)),
      embedQuery: mock(async () => new Array(1024).fill(0.1)),
    };
    // batch=2 -> 3 batches -> inter-batch yields
    const worker = new EmbeddingWorker(db, provider, strategy, 1024, 2);

    let interleaved = false;
    const p = worker.processPending();
    setTimeout(() => {
      interleaved = true;
    }, 0);
    await p;

    expect(interleaved).toBe(true);
  });
});
