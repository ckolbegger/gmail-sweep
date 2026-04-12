import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { EmbeddingWorker } from "@backend/services/embedding-worker";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";
import type { EmbeddingProvider } from "@backend/llm/provider";

function createMockEmbeddingProvider(embeddings: number[][]): EmbeddingProvider {
  let callIndex = 0;
  return {
    embed: mock(() => {
      const res = embeddings[callIndex++];
      if (!res) throw new Error("No more mock embeddings");
      return Promise.resolve(res);
    }),
  };
}

function seedEmail(db: Database, overrides: Partial<{
  id: string;
  subject: string;
  summary: string;
  ai_status: string;
  embedding: Uint8Array | null;
}> = {}) {
  const {
    id = `m${Math.random().toString(36).slice(2, 8)}`,
    subject = "Test",
    summary = "Summary text",
    ai_status = "done",
    embedding = null,
  } = overrides;

  db.run(
    `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, ai_status, summary, embedding, embedding_model, embedding_generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, "t1", "a@b.com", '[]', subject, "Body", "", 1000, 1000, '[]', 0, 0, Date.now(), ai_status, summary, embedding, null, null]
  );
  return id;
}

describe("EmbeddingWorker", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("processPending", () => {
    it("should query emails where embedding IS NULL and ai_status = done", async () => {
      seedEmail(db, { id: "m1", ai_status: "done", embedding: null });
      seedEmail(db, { id: "m2", ai_status: "pending", embedding: null });
      seedEmail(db, { id: "m3", ai_status: "done", embedding: new Uint8Array(Buffer.from("x")) });

      const provider = createMockEmbeddingProvider([[0.1, 0.2]]);
      const worker = new EmbeddingWorker(db, provider);

      const result = await worker.processPending();
      expect(result.processed).toBe(1);
    });

    it("should generate embedding for subject + summary", async () => {
      seedEmail(db, { id: "m1", subject: "Hello", summary: "World" });

      const provider: EmbeddingProvider = {
        embed: mock(async (text: string) => {
          expect(text).toBe("Hello World");
          return [0.1, 0.2, 0.3];
        }),
      };

      const worker = new EmbeddingWorker(db, provider);
      await worker.processPending();

      const row = db.query("SELECT embedding, embedding_model, embedding_generated_at FROM emails WHERE id = 'm1'").get() as any;
      expect(row.embedding).not.toBeNull();
      expect(row.embedding_model).toBe("mock");
      expect(row.embedding_generated_at).toBeGreaterThan(0);
    });

    it("should store embedding as BLOB (Float32Array)", async () => {
      seedEmail(db, { id: "m1" });

      const expectedEmbedding = [0.1, 0.2, 0.3];
      const provider = createMockEmbeddingProvider([expectedEmbedding]);
      const worker = new EmbeddingWorker(db, provider);
      await worker.processPending();

      const row = db.query("SELECT embedding FROM emails WHERE id = 'm1'").get() as any;
      const blob: Uint8Array = row.embedding;
      const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      expect(float32[0]).toBeCloseTo(0.1);
      expect(float32[1]).toBeCloseTo(0.2);
      expect(float32[2]).toBeCloseTo(0.3);
    });

    it("should return 0 processed when no eligible emails", async () => {
      seedEmail(db, { id: "m1", ai_status: "pending", embedding: null });

      const provider = createMockEmbeddingProvider([]);
      const worker = new EmbeddingWorker(db, provider);
      const result = await worker.processPending();

      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should set failed on embedding error and continue", async () => {
      seedEmail(db, { id: "m1" });
      seedEmail(db, { id: "m2" });

      let callCount = 0;
      const provider: EmbeddingProvider = {
        embed: mock(async () => {
          callCount++;
          if (callCount === 1) throw new Error("Embedding error");
          return [0.5, 0.6];
        }),
      };

      const worker = new EmbeddingWorker(db, provider);
      const result = await worker.processPending();

      expect(result.failed).toBe(1);
      expect(result.processed).toBe(1);

      const m1 = db.query("SELECT embedding FROM emails WHERE id = 'm1'").get() as any;
      expect(m1.embedding).toBeNull();

      const m2 = db.query("SELECT embedding FROM emails WHERE id = 'm2'").get() as any;
      expect(m2.embedding).not.toBeNull();
    });

    it("should process concurrently up to concurrency limit", async () => {
      for (let i = 0; i < 6; i++) {
        seedEmail(db, { id: `m${i}` });
      }

      const concurrency = 3;
      let maxInFlight = 0;
      let currentInFlight = 0;

      const provider: EmbeddingProvider = {
        embed: mock(async () => {
          currentInFlight++;
          if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
          await new Promise((r) => setTimeout(r, 10));
          currentInFlight--;
          return [0.1];
        }),
      };

      const worker = new EmbeddingWorker(db, provider, concurrency);
      const result = await worker.processPending();

      expect(result.processed).toBe(6);
      expect(maxInFlight).toBeLessThanOrEqual(concurrency);
    });
  });
});
