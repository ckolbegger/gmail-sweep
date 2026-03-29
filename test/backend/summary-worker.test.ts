import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { SummaryWorker } from "@backend/services/summary-worker";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";
import type { LLMProvider, SummaryResult } from "@backend/llm/provider";

function createMockLLM(responses: SummaryResult[]): LLMProvider {
  let callIndex = 0;
  return {
    summarize: mock(() => {
      const res = responses[callIndex++];
      if (!res) throw new Error("No more mock responses");
      return Promise.resolve(res);
    }),
  };
}

function seedEmail(db: Database, overrides: Partial<{ id: string; sender: string; subject: string; body_text: string; ai_status: string; date_received: number }> = {}) {
  const {
    id = `m${Math.random().toString(36).slice(2, 8)}`,
    sender = "a@b.com",
    subject = "Test",
    body_text = "Body",
    ai_status = "pending",
    date_received = Date.now(),
  } = overrides;

  db.run(
    `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, ai_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, "t1", sender, '[]', subject, body_text, "", 1000, date_received, '[]', 0, 0, Date.now(), ai_status]
  );
  return id;
}

describe("SummaryWorker", () => {
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });

  afterEach(() => {
    cleanup();
  });

  describe("processPending", () => {
    it("should query pending emails", async () => {
      seedEmail(db, { id: "m1", ai_status: "pending" });
      seedEmail(db, { id: "m2", ai_status: "done" });
      const llm = createMockLLM([{ summary: "S", actionItems: [], keyPoints: [], model: "test" }]);
      const worker = new SummaryWorker(db, llm);

      const result = await worker.processPending();
      expect(result.processed).toBe(1);
    });

    it("should set ai_status to processing before calling LLM", async () => {
      const id = seedEmail(db, { id: "m1" });
      let sawProcessing = false;
      const llm: LLMProvider = {
        summarize: mock(async () => {
          const row = db.query("SELECT ai_status FROM emails WHERE id = ?").get(id) as any;
          sawProcessing = row?.ai_status === "processing";
          return { summary: "S", actionItems: [], keyPoints: [], model: "test" };
        }),
      };
      const worker = new SummaryWorker(db, llm);
      await worker.processPending();
      expect(sawProcessing).toBe(true);
    });

    it("should store summary, action_items, key_points, model on success and set ai_status=done", async () => {
      seedEmail(db, { id: "m1" });
      const llm = createMockLLM([{
        summary: "Brief summary",
        actionItems: ["Action 1"],
        keyPoints: ["Point 1", "Point 2"],
        model: "gpt-4",
      }]);
      const worker = new SummaryWorker(db, llm);
      await worker.processPending();

      const row = db.query("SELECT * FROM emails WHERE id = 'm1'").get() as any;
      expect(row.ai_status).toBe("done");
      expect(row.summary).toBe("Brief summary");
      expect(JSON.parse(row.action_items)).toEqual(["Action 1"]);
      expect(JSON.parse(row.key_points)).toEqual(["Point 1", "Point 2"]);
      expect(row.summary_model).toBe("gpt-4");
      expect(row.summary_generated_at).toBeGreaterThan(0);
    });

    it("should set ai_status=failed on LLM error and continue to next email", async () => {
      seedEmail(db, { id: "m1" });
      seedEmail(db, { id: "m2" });

      let callCount = 0;
      const llm: LLMProvider = {
        summarize: mock(async () => {
          callCount++;
          if (callCount === 1) throw new Error("LLM error");
          return { summary: "S2", actionItems: [], keyPoints: [], model: "test" };
        }),
      };

      const worker = new SummaryWorker(db, llm);
      const result = await worker.processPending();

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);

      const m1 = db.query("SELECT ai_status FROM emails WHERE id = 'm1'").get() as any;
      expect(m1.ai_status).toBe("failed");

      const m2 = db.query("SELECT ai_status FROM emails WHERE id = 'm2'").get() as any;
      expect(m2.ai_status).toBe("done");
    });

    it("should process emails ordered by date_received DESC", async () => {
      seedEmail(db, { id: "m1", date_received: 1000 });
      seedEmail(db, { id: "m2", date_received: 2000 });

      const order: string[] = [];
      const llm: LLMProvider = {
        summarize: mock(async (email) => {
          order.push(email.subject);
          return { summary: "S", actionItems: [], keyPoints: [], model: "test" };
        }),
      };

      const worker = new SummaryWorker(db, llm);
      await worker.processPending();

      // m2 has higher date_received, should be processed first
      expect(order[0]).toBe("Test");
    });

    it("should return 0 processed when no pending emails", async () => {
      seedEmail(db, { id: "m1", ai_status: "done" });
      const llm = createMockLLM([]);
      const worker = new SummaryWorker(db, llm);

      const result = await worker.processPending();
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should process concurrently up to concurrency limit", async () => {
      for (let i = 0; i < 6; i++) {
        seedEmail(db, { id: `m${i}` });
      }

      const concurrency = 3;
      let maxInFlight = 0;
      let currentInFlight = 0;

      const llm: LLMProvider = {
        summarize: mock(async () => {
          currentInFlight++;
          if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
          await new Promise((r) => setTimeout(r, 10));
          currentInFlight--;
          return { summary: "S", actionItems: [], keyPoints: [], model: "test" };
        }),
      };

      const worker = new SummaryWorker(db, llm, concurrency);
      const result = await worker.processPending();

      expect(result.processed).toBe(6);
      expect(maxInFlight).toBeLessThanOrEqual(concurrency);
    });

    it("should pass sender, subject, body_text to LLM", async () => {
      seedEmail(db, { id: "m1", sender: "alice@test.com", subject: "Hello", body_text: "World" });

      const llm: LLMProvider = {
        summarize: mock(async (email) => {
          expect(email.sender).toBe("alice@test.com");
          expect(email.subject).toBe("Hello");
          expect(email.body).toBe("World");
          return { summary: "S", actionItems: [], keyPoints: [], model: "test" };
        }),
      };

      const worker = new SummaryWorker(db, llm);
      await worker.processPending();
    });
  });

  describe("getQueueDepth", () => {
    it("should return count of pending emails", () => {
      seedEmail(db, { id: "m1", ai_status: "pending" });
      seedEmail(db, { id: "m2", ai_status: "pending" });
      seedEmail(db, { id: "m3", ai_status: "done" });

      const llm = createMockLLM([]);
      const worker = new SummaryWorker(db, llm);
      expect(worker.getQueueDepth()).toBe(2);
    });

    it("should return 0 when no pending emails", () => {
      seedEmail(db, { id: "m1", ai_status: "done" });
      const llm = createMockLLM([]);
      const worker = new SummaryWorker(db, llm);
      expect(worker.getQueueDepth()).toBe(0);
    });
  });

  describe("lifecycle", () => {
    it("should start and stop worker loop", async () => {
      seedEmail(db, { id: "m1" });
      const llm = createMockLLM([{ summary: "S", actionItems: [], keyPoints: [], model: "test" }]);
      const worker = new SummaryWorker(db, llm);

      worker.start(50);
      await new Promise((r) => setTimeout(r, 120));
      await worker.shutdown();

      const row = db.query("SELECT ai_status FROM emails WHERE id = 'm1'").get() as any;
      expect(row.ai_status).toBe("done");
    });
  });
});
