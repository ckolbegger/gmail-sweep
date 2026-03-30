import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SearchService } from "@backend/services/search";
import type { SearchResult } from "@backend/services/search";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

function seedEmails(db: Database) {
  const now = Date.now();
  const emails = [
    {
      id: "e1", thread_id: "t1", sender: "alice@example.com",
      recipients: '["bob@example.com"]', subject: "Meeting tomorrow",
      body_text: "Let's meet at 3pm", date_received: now - 1000,
      is_read: 0, is_starred: 0, summary: "Schedule a meeting",
    },
    {
      id: "e2", thread_id: "t2", sender: "carol@example.com",
      recipients: '["bob@example.com"]', subject: "Project update",
      body_text: "The project is on track", date_received: now - 2000,
      is_read: 1, is_starred: 0, summary: "Project status update",
    },
    {
      id: "e3", thread_id: "t3", sender: "dave@example.com",
      recipients: '["bob@example.com"]', subject: "Re: Meeting tomorrow",
      body_text: "I can make it", date_received: now - 500,
      is_read: 0, is_starred: 1, summary: "Confirming meeting attendance",
    },
  ];
  for (const e of emails) {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '[{"id":"INBOX","name":"INBOX"}]', ?, ?, ?, ?)`,
      [e.id, e.thread_id, e.sender, e.recipients, e.subject, e.body_text,
       e.date_received, e.date_received, e.is_read, e.is_starred, Date.now(), e.summary]
    );
  }
}

function seedEmailWithEmbedding(db: Database, id: string, embedding: number[]) {
  const blob = Buffer.from(new Float64Array(embedding).buffer);
  db.run("UPDATE emails SET embedding = ? WHERE id = ?", [blob, id]);
}

function mockEmbeddingProvider(embedding: number[]) {
  return { embed: async () => embedding };
}

describe("SearchService", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    seedEmails(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe("pure SQL search", () => {
    it("returns results with no free text (operators only)", async () => {
      const service = new SearchService(db);
      const results = await service.search("is:unread");
      expect(results.length).toBe(2);
      expect(results.every((r) => r.is_read === false)).toBe(true);
    });

    it("returns results ordered by date_received descending", async () => {
      const service = new SearchService(db);
      const results = await service.search("is:unread");
      expect(results.length).toBe(2);
      expect(results[0].id).toBe("e3");
      expect(results[1].id).toBe("e1");
    });

    it("filters by free text using LIKE in SQL-only mode", async () => {
      const service = new SearchService(db);
      const results = await service.search("meeting");
      expect(results.length).toBe(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("e1");
      expect(ids).toContain("e3");
    });

    it("returns empty results when free text matches nothing", async () => {
      const service = new SearchService(db);
      const results = await service.search("nonexistent-query-xyz");
      expect(results.length).toBe(0);
    });

    it("combines free text LIKE with operator filters", async () => {
      const service = new SearchService(db);
      const results = await service.search("meeting from:alice@example.com");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("e1");
    });

    it("respects the limit parameter", async () => {
      const service = new SearchService(db);
      const results = await service.search("", 2);
      expect(results.length).toBe(2);
    });

    it("returns score as null for SQL-only results", async () => {
      const service = new SearchService(db);
      const results = await service.search("is:unread");
      expect(results.every((r) => r.score === null)).toBe(true);
    });

    it("returns correct field types (is_read, is_starred as booleans)", async () => {
      const service = new SearchService(db);
      const results = await service.search("is:unread");
      const e3 = results.find((r) => r.id === "e3")!;
      expect(e3.is_read).toBe(false);
      expect(e3.is_starred).toBe(true);
      expect(typeof e3.is_read).toBe("boolean");
      expect(typeof e3.is_starred).toBe("boolean");
    });

    it("returns all expected fields", async () => {
      const service = new SearchService(db);
      const results = await service.search("");
      const r = results[0];
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("thread_id");
      expect(r).toHaveProperty("sender");
      expect(r).toHaveProperty("recipients");
      expect(r).toHaveProperty("subject");
      expect(r).toHaveProperty("date_received");
      expect(r).toHaveProperty("is_read");
      expect(r).toHaveProperty("is_starred");
      expect(r).toHaveProperty("summary");
      expect(r).toHaveProperty("score");
    });
  });

  describe("vector search", () => {
    it("ranks results by cosine similarity when embedding provider is available", async () => {
      // Give all emails the same embedding dimension
      const dim = 3;
      // e1 embedding points in same direction as query
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      // e2 embedding points in different direction
      seedEmailWithEmbedding(db, "e2", [0, 1, 0]);
      // e3 embedding is somewhat similar
      seedEmailWithEmbedding(db, "e3", [0.9, 0.1, 0]);

      const provider = mockEmbeddingProvider([1, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      // e1 should be most similar (cos ~= 1.0)
      // e3 should be second (cos ~= 0.9/sqrt(0.82))
      // e2 should be least similar (cos ~= 0.0)
      expect(results[0].id).toBe("e1");
      expect(results[0].score).toBeGreaterThan(0.9);
      expect(results[1].id).toBe("e3");
      expect(results[2].id).toBe("e2");
      expect(results[2].score).toBeLessThan(0.2);
    });

    it("excludes emails without embeddings from vector search", async () => {
      const dim = 3;
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      // e2 and e3 have no embeddings

      const provider = mockEmbeddingProvider([1, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      expect(results.length).toBe(1);
      expect(results[0].id).toBe("e1");
    });

    it("applies SQL filters alongside vector search", async () => {
      const dim = 3;
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      seedEmailWithEmbedding(db, "e2", [0, 1, 0]);
      seedEmailWithEmbedding(db, "e3", [0.9, 0.1, 0]);

      const provider = mockEmbeddingProvider([1, 0, 0]);
      const service = new SearchService(db, provider);
      // Only unread emails
      const results = await service.search("is:unread meeting");

      expect(results.length).toBe(2);
      expect(results.every((r) => r.is_read === false)).toBe(true);
    });

    it("returns similarity score with each vector result", async () => {
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      const provider = mockEmbeddingProvider([1, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      expect(results[0].score).not.toBeNull();
      expect(typeof results[0].score).toBe("number");
    });

    it("respects limit in vector search", async () => {
      const dim = 3;
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      seedEmailWithEmbedding(db, "e2", [0, 1, 0]);
      seedEmailWithEmbedding(db, "e3", [0.9, 0.1, 0]);

      const provider = mockEmbeddingProvider([1, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting", 1);

      expect(results.length).toBe(1);
    });
  });

  describe("cosine similarity", () => {
    it("computes 1.0 for identical vectors", async () => {
      seedEmailWithEmbedding(db, "e1", [1, 2, 3]);
      const provider = mockEmbeddingProvider([1, 2, 3]);
      const service = new SearchService(db, provider);
      const results = await service.search("test");
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it("computes 0.0 for orthogonal vectors", async () => {
      seedEmailWithEmbedding(db, "e1", [1, 0, 0]);
      const provider = mockEmbeddingProvider([0, 1, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("test");
      expect(results[0].score).toBeCloseTo(0.0, 5);
    });

    it("handles zero vectors gracefully", async () => {
      seedEmailWithEmbedding(db, "e1", [0, 0, 0]);
      const provider = mockEmbeddingProvider([1, 2, 3]);
      const service = new SearchService(db, provider);
      const results = await service.search("test");
      expect(results[0].score).toBe(0); // 0/1 = 0 (div-by-zero guard)
    });
  });
});
