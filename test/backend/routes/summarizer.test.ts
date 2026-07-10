import { describe, it, expect } from "bun:test";
import { createApp } from "../../../src/backend/server";
import { createTestDb } from "../../helpers/test-db";
import { SummaryWorker } from "../../../src/backend/services/summary-worker";

const fakeLlm = {
  summarize: async () => ({ summary: "s", actionItems: [], keyPoints: [], model: "m" }),
  parseSearchQuery: async () => ({ filters: {}, semanticQuery: "" }),
} as any;

describe("GET /summarizer/status", () => {
  it("returns the pending summary queue depth", async () => {
    const { db, cleanup } = createTestDb();
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received, recipients, labels)
       VALUES ('e1','t','s','subj','body','pending',1,'[]','[]')`
    );
    const summaryWorker = new SummaryWorker(db, fakeLlm);
    const app = createApp({ db, summaryWorker });

    const res = await app.request("/summarizer/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 1 });
    cleanup();
  });

  it("returns 0 when no emails are pending", async () => {
    const { db, cleanup } = createTestDb();
    const summaryWorker = new SummaryWorker(db, fakeLlm);
    const app = createApp({ db, summaryWorker });

    const res = await app.request("/summarizer/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 0 });
    cleanup();
  });
});
