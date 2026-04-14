import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SearchService } from "@backend/services/search";
import type { SearchResult } from "@backend/services/search";
import { initDb } from "@backend/db";
import type Database from "bun:sqlite";
import type { EmbedProvider } from "@backend/services/embed-provider";

function createTestDb(): { db: Database; cleanup: () => void } {
  const { mkdtempSync, rmSync } = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const dir = mkdtempSync(join(tmpdir(), "gmail-sweep-search-"));
  const dbPath = join(dir, "test.db");
  const db = initDb(dbPath);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

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

function seedVecEmbedding(db: Database, id: string, embedding: number[]) {
  // Pad to 1024 dimensions to match vec_embeddings schema
  const padded = new Array(1024).fill(0);
  for (let i = 0; i < embedding.length; i++) padded[i] = embedding[i];
  const buf = Buffer.from(new Float32Array(padded).buffer);
  db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", [id, buf]);
}

function padVec(embedding: number[]): number[] {
  const padded = new Array(1024).fill(0);
  for (let i = 0; i < embedding.length; i++) padded[i] = embedding[i];
  return padded;
}

function mockEmbedProvider(embedding: number[]): EmbedProvider {
  const padded = padVec(embedding);
  return {
    embedDocument: async () => padded,
    embedQuery: async () => padded,
  };
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
    it("ranks results by similarity when embedding provider is available", async () => {
      // e1 embedding points in same direction as query
      seedVecEmbedding(db, "e1", [1, 0, 0, 0]);
      // e2 embedding points in different direction
      seedVecEmbedding(db, "e2", [0, 1, 0, 0]);
      // e3 embedding is somewhat similar
      seedVecEmbedding(db, "e3", [0.9, 0.1, 0, 0]);

      const provider = mockEmbedProvider([1, 0, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      // e1 should be most similar
      expect(results[0].id).toBe("e1");
      expect(results[0].score).toBeGreaterThan(0.9);
      expect(results[1].id).toBe("e3");
      expect(results[2].id).toBe("e2");
    });

    it("excludes emails without vec embeddings from vector search", async () => {
      seedVecEmbedding(db, "e1", [1, 0, 0, 0]);
      // e2 and e3 have no embeddings

      const provider = mockEmbedProvider([1, 0, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      expect(results.length).toBe(1);
      expect(results[0].id).toBe("e1");
    });

    it("applies SQL filters alongside vector search", async () => {
      seedVecEmbedding(db, "e1", [1, 0, 0, 0]);
      seedVecEmbedding(db, "e2", [0, 1, 0, 0]);
      seedVecEmbedding(db, "e3", [0.9, 0.1, 0, 0]);

      const provider = mockEmbedProvider([1, 0, 0, 0]);
      const service = new SearchService(db, provider);
      // Only unread emails
      const results = await service.search("is:unread meeting");

      expect(results.length).toBe(2);
      expect(results.every((r) => r.is_read === false)).toBe(true);
    });

    it("returns similarity score with each vector result", async () => {
      seedVecEmbedding(db, "e1", [1, 0, 0, 0]);
      const provider = mockEmbedProvider([1, 0, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting");

      expect(results[0].score).not.toBeNull();
      expect(typeof results[0].score).toBe("number");
    });

    it("respects limit in vector search", async () => {
      seedVecEmbedding(db, "e1", [1, 0, 0, 0]);
      seedVecEmbedding(db, "e2", [0, 1, 0, 0]);
      seedVecEmbedding(db, "e3", [0.9, 0.1, 0, 0]);

      const provider = mockEmbedProvider([1, 0, 0, 0]);
      const service = new SearchService(db, provider);
      const results = await service.search("meeting", 1);

      expect(results.length).toBe(1);
    });
  });
});
