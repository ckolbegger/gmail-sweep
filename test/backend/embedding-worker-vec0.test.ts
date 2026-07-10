import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb } from "@backend/db";
import { EmbeddingWorker } from "@backend/services/embedding-worker";
import type Database from "bun:sqlite";

const fakeProvider = {
  embedDocument: async () => new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
  embedQuery: async () => new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
};

const defaultStrategy = { type: "template" as const, template: "{{subject}} {{body_text}}" };

describe("EmbeddingWorker with vec0", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "ew-test-"));
    const dbPath = require("node:path").join(dir, "test.db");
    db = initDb(dbPath);
    cleanup = () => {
      db.close();
      require("node:fs").rmSync(dir, { recursive: true, force: true });
    };
  });

  afterEach(() => {
    cleanup();
  });

  test("inserts a row into vec_embeddings for each done email without embedding", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e1','t','s','hi','body','done',1,'[]','[]')`
    );
    const w = new EmbeddingWorker(db, fakeProvider, defaultStrategy, 1024);
    const r = await w.processPending();
    expect(r.processed).toBe(1);
    const row = db.query("SELECT email_id FROM vec_embeddings WHERE email_id = ?").get("e1") as any;
    expect(row?.email_id).toBe("e1");
  });

  test("skips emails that already have a vec_embeddings row", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e1','t','s','hi','body','done',1,'[]','[]')`
    );
    // Insert a pre-existing vec_embeddings row
    const vec = Buffer.from(new Float32Array(1024).fill(0).map((_, i) => i === 0 ? 1 : 0).buffer);
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["e1", vec]);

    const w = new EmbeddingWorker(db, fakeProvider, defaultStrategy, 1024);
    const r = await w.processPending();
    expect(r.processed).toBe(0);
    expect(r.failed).toBe(0);
  });

  test("uses extraction strategy template to build embedding text", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e1','t','s','TestSubject','TestBody','done',1,'[]','[]')`
    );

    let capturedText = "";
    const spyProvider = {
      embedDocument: async (text: string) => {
        capturedText = text;
        return new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
      },
      embedQuery: async () => new Array(1024).fill(0),
    };

    const strategy = { type: "template" as const, template: "S:{{subject}}|B:{{body_text}}" };
    const w = new EmbeddingWorker(db, spyProvider, strategy, 1024);
    await w.processPending();
    expect(capturedText).toBe("S:TestSubject|B:TestBody");
  });

  test("reports failed count on embedding error", async () => {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e1','t','s','hi','body','done',1,'[]','[]')`
    );
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e2','t','s','hi2','body2','done',1,'[]','[]')`
    );

    let callCount = 0;
    const flakyProvider = {
      embedDocument: async () => {
        callCount++;
        if (callCount === 1) throw new Error("boom");
        return new Array(1024).fill(0);
      },
      embedQuery: async () => new Array(1024).fill(0),
    };

    const w = new EmbeddingWorker(db, flakyProvider, defaultStrategy, 1024);
    const r = await w.processPending();
    expect(r.failed).toBe(1);
    expect(r.processed).toBe(1);
  });

  test("stop() cancels an in-flight processPending batch", async () => {
    for (let i = 0; i < 40; i++) {
      db.run(
        `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
         VALUES ('e${i}','t','s','hi','body','done',1,'[]','[]')`
      );
    }
    const slow = {
      embedDocument: async () => {
        await new Promise((r) => setTimeout(r, 15));
        return new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
      },
      embedQuery: async () => new Array(1024).fill(0),
    };
    const w = new EmbeddingWorker(db, slow as any, defaultStrategy, 1024, 4);
    const p = w.processPending();
    w.stop();
    const r = await p;
    // Cancellation lands after the first slice; the whole batch is not processed.
    expect(r.processed + r.failed).toBeLessThan(40);
  });
});
