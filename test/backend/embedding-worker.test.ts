import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { EmbeddingWorker } from "@backend/services/embedding-worker";
import { initDb } from "@backend/db";
import type Database from "bun:sqlite";
import type { EmbedProvider } from "@backend/services/embed-provider";
import type { ExtractionStrategy } from "@shared/types";

const defaultStrategy: ExtractionStrategy = { type: "template", template: "{{subject}} {{body_text}}" };

function createMockProvider(embeddings: number[][]): EmbedProvider {
  let callIndex = 0;
  return {
    embedDocument: mock(async () => {
      const res = embeddings[callIndex++];
      if (!res) throw new Error("No more mock embeddings");
      return res;
    }),
    embedQuery: mock(async () => embeddings[0] ?? []),
  };
}

function seedEmail(db: Database, overrides: Partial<{
  id: string;
  subject: string;
  body_text: string;
  ai_status: string;
}> = {}) {
  const {
    id = `m${Math.random().toString(36).slice(2, 8)}`,
    subject = "Test",
    body_text = "Body",
    ai_status = "done",
  } = overrides;

  db.run(
    `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, ai_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, "t1", "a@b.com", '[]', subject, body_text, "", 1000, 1000, '[]', 0, 0, Date.now(), ai_status]
  );
  return id;
}

function seedVecEmbedding(db: Database, emailId: string) {
  // Insert a fake vec row so the worker skips this email
  const vec = Buffer.from(new Float32Array(1024).buffer);
  db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", [emailId, vec]);
}

describe("EmbeddingWorker (vec0)", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-ew-"));
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

  describe("processPending", () => {
    it("should insert a vec_embeddings row for emails without one", async () => {
      seedEmail(db, { id: "m1" });

      const provider = createMockProvider([new Array(1024).fill(0.1)]);
      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      const result = await worker.processPending();
      expect(result.processed).toBe(1);

      const row = db.query("SELECT email_id FROM vec_embeddings WHERE email_id = ?").get("m1") as any;
      expect(row?.email_id).toBe("m1");
    });

    it("should skip emails that already have a vec_embeddings row", async () => {
      seedEmail(db, { id: "m1" });
      seedVecEmbedding(db, "m1");

      const provider = createMockProvider([]);
      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      const result = await worker.processPending();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should use extraction strategy template to build embedding text", async () => {
      seedEmail(db, { id: "m1", subject: "Hello", body_text: "World" });

      let capturedText = "";
      const provider: EmbedProvider = {
        embedDocument: mock(async (text: string) => {
          capturedText = text;
          return new Array(1024).fill(0.1);
        }),
        embedQuery: mock(async () => []),
      };

      const strategy: ExtractionStrategy = { type: "template", template: "{{subject}} {{body_text}}" };
      const worker = new EmbeddingWorker(db, provider, strategy, 1024);
      await worker.processPending();

      expect(capturedText).toBe("Hello World");
    });

    it("should store embedding as Float32Array in vec_embeddings", async () => {
      seedEmail(db, { id: "m1" });

      const expectedVec = new Array(1024).fill(0).map((_, i) => i < 3 ? [0.1, 0.2, 0.3][i] : 0);
      const provider = createMockProvider([expectedVec]);
      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      await worker.processPending();

      // Verify the row is there via direct query
      const row = db.query("SELECT email_id, embedding FROM vec_embeddings WHERE email_id = ?").get("m1") as any;
      expect(row).not.toBeNull();
      expect(row.email_id).toBe("m1");
      // Verify the stored embedding bytes match
      const storedF32 = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      expect(storedF32.length).toBe(1024);
      expect(storedF32[0]).toBeCloseTo(0.1);
      expect(storedF32[1]).toBeCloseTo(0.2);
      expect(storedF32[2]).toBeCloseTo(0.3);
    });

    it("should return 0 processed when no eligible emails", async () => {
      seedEmail(db, { id: "m1", ai_status: "pending" });
      seedVecEmbedding(db, "m1");

      const provider = createMockProvider([]);
      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      const result = await worker.processPending();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should report failed on embedding error and continue", async () => {
      seedEmail(db, { id: "m1" });
      seedEmail(db, { id: "m2" });

      let callCount = 0;
      const provider: EmbedProvider = {
        embedDocument: mock(async () => {
          callCount++;
          if (callCount === 1) throw new Error("Embedding error");
          return new Array(1024).fill(0.5);
        }),
        embedQuery: mock(async () => []),
      };

      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      const result = await worker.processPending();

      expect(result.failed).toBe(1);
      expect(result.processed).toBe(1);

      // Exactly one email should have a vec row
      const total = db.query("SELECT COUNT(*) as c FROM vec_embeddings").get() as any;
      expect(total.c).toBe(1);
    });

    it("should process in batches", async () => {
      for (let i = 0; i < 6; i++) {
        seedEmail(db, { id: `m${i}` });
      }

      const concurrency = 3;
      const provider = createMockProvider(
        Array.from({ length: 6 }, () => new Array(1024).fill(0.1))
      );

      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024, concurrency);
      const result = await worker.processPending();
      expect(result.processed).toBe(6);
    });

    it("should reject embeddings with wrong dimension", async () => {
      seedEmail(db, { id: "m1" });

      const provider = createMockProvider([[0.1, 0.2, 0.3]]); // 3-dim, expected 1024
      const worker = new EmbeddingWorker(db, provider, defaultStrategy, 1024);
      const result = await worker.processPending();

      expect(result.failed).toBe(1);
      expect(result.processed).toBe(0);
    });
  });
});
