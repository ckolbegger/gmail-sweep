import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "../../helpers/test-db";
import { SummaryWorker } from "../../../src/backend/services/summary-worker";
import { createSummarizerRouter } from "../../../src/backend/routes/summarizer";
import type Database from "bun:sqlite";

const mockLlm = {
  summarize: async () => ({ summary: "s", actionItems: [], keyPoints: [], model: "mock" }),
  parseSearchQuery: async () => ({ filters: {}, semanticQuery: "" }),
} as any;

describe("GET /summarizer/status", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });
  afterEach(() => cleanup());

  it("returns SummarizerStatus with processed and pending counts", async () => {
    db.run(`INSERT INTO emails (id, thread_id, sender, subject, date_received, recipients, labels, ai_status)
            VALUES ('a','t','s','done1',1,'[]','[]','done'),
                   ('b','t','s','done2',2,'[]','[]','done'),
                   ('c','t','s','pend',3,'[]','[]','pending')`);

    const worker = new SummaryWorker(db, mockLlm);
    const app = createSummarizerRouter(worker);

    const res = await app.request("/summarizer/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(2);
    expect(body.pending).toBe(1);
    expect(body.status).toBe("idle"); // not started
  });

  it("status reflects running state", async () => {
    const worker = new SummaryWorker(db, mockLlm);
    expect(worker.isRunning()).toBe(false);
    worker.start(60_000);
    expect(worker.isRunning()).toBe(true);
    await worker.shutdown();
    expect(worker.isRunning()).toBe(false);
  });
});
