import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import Database from "bun:sqlite";
import { loadVecExtension } from "../../../src/backend/db/vec-loader";
import { createApp } from "../../../src/backend/server";
import { EmbeddingWorker } from "../../../src/backend/services/embedding-worker";
import type { EmbedProvider } from "../../../src/backend/services/embed-provider";
import type { ExtractionStrategy } from "../../../src/shared/types";

const mockProvider: EmbedProvider = {
  embedDocument: async () => new Array(4).fill(0.1),
  embedQuery: async () => new Array(4).fill(0.1),
};
const strategy: ExtractionStrategy = {
  type: "template",
  template: "Subject: {{subject}}\n\n{{body_text}}",
};

describe("GET /embeddings/status", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    loadVecExtension(db);
    db.run("CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, subject TEXT, body_text TEXT, body_html TEXT DEFAULT '', date_received INTEGER, date_sent INTEGER DEFAULT 0, thread_id TEXT DEFAULT '', sender TEXT DEFAULT '', recipients TEXT DEFAULT '[]', labels TEXT DEFAULT '[]', is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, fetched_at INTEGER DEFAULT 0)");
    db.run("CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(embedding float[4] distance_metric=cosine, +email_id TEXT)");
  });

  afterEach(() => {
    db.close();
  });

  it("returns totalEmails and unembedded count", async () => {
    db.run("INSERT INTO emails (id, subject, body_text, date_received) VALUES (?, ?, ?, ?)", ["e1", "Test", "body", Date.now()]);
    db.run("INSERT INTO emails (id, subject, body_text, date_received) VALUES (?, ?, ?, ?)", ["e2", "Test2", "body2", Date.now()]);

    const embeddingWorker = new EmbeddingWorker(db, mockProvider, strategy, 4);
    const app = createApp({ db, embeddingWorker });

    const res = await app.request("/embeddings/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEmails).toBe(2);
    expect(body.unembedded).toBe(2);
  });

  it("reports 0 unembedded after processing", async () => {
    db.run("INSERT INTO emails (id, subject, body_text, date_received) VALUES (?, ?, ?, ?)", ["e1", "Test", "body", Date.now()]);

    const embeddingWorker = new EmbeddingWorker(db, mockProvider, strategy, 4);
    await embeddingWorker.processPending();

    const app = createApp({ db, embeddingWorker });
    const res = await app.request("/embeddings/status");
    const body = await res.json();
    expect(body.totalEmails).toBe(1);
    expect(body.unembedded).toBe(0);
  });
});

describe("POST /embeddings/stop and /embeddings/start", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    loadVecExtension(db);
    db.run("CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, subject TEXT, body_text TEXT, body_html TEXT DEFAULT '', date_received INTEGER, date_sent INTEGER DEFAULT 0, thread_id TEXT DEFAULT '', sender TEXT DEFAULT '', recipients TEXT DEFAULT '[]', labels TEXT DEFAULT '[]', is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, fetched_at INTEGER DEFAULT 0)");
    db.run("CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(embedding float[4] distance_metric=cosine, +email_id TEXT)");
  });

  afterEach(() => {
    db.close();
  });

  it("POST /embeddings/stop halts the worker", async () => {
    const embeddingWorker = new EmbeddingWorker(db, mockProvider, strategy, 4);
    const app = createApp({ db, embeddingWorker });
    embeddingWorker.start(60_000);

    const res = await app.request("/embeddings/stop", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("stopped");
  });

  it("POST /embeddings/start (re)starts the worker", async () => {
    const embeddingWorker = new EmbeddingWorker(db, mockProvider, strategy, 4);
    const app = createApp({ db, embeddingWorker });

    const res = await app.request("/embeddings/start", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("started");

    embeddingWorker.stop();
  });
});
