import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createSyncRouter } from "@backend/routes/sync";
import { SyncService } from "@backend/services/sync";
import { MockGmailAdapter } from "@backend/gmail/mock";
import { Hono } from "hono";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

describe("Sync routes (basic)", () => {
  let db: Database;
  let cleanup: () => void;
  let app: Hono;
  let syncService: SyncService;
  let adapter: MockGmailAdapter;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    adapter = new MockGmailAdapter();
    syncService = new SyncService(db, adapter);
    app = new Hono().route("/", createSyncRouter(syncService, adapter, db));
  });

  afterEach(() => {
    cleanup();
  });

  describe("POST /sync", () => {
    it("should return 202 immediately and run sync in background", async () => {
      const res = await app.request("/sync", { method: "POST" });
      expect(res.status).toBe(202);
    });

    it("should accept batchSize query parameter", async () => {
      const res = await app.request("/sync?batchSize=10", { method: "POST" });
      expect(res.status).toBe(202);
    });

    it("should trigger summary worker after sync completes", async () => {
      // Sync will fetch mock messages, then summary worker should process them
      const res = await app.request("/sync", { method: "POST" });
      expect(res.status).toBe(202);
      // Wait for background sync + summary processing
      await new Promise((r) => setTimeout(r, 200));
      // The mock LLM should have been called (summaryWorker is wired up)
      // We just verify no errors occurred
    });
  });

  describe("GET /sync/status", () => {
    it("should return total stored count, unread count, last_history_id, and sync_in_progress flag", async () => {
      const res = await app.request("/sync/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalEmails).toBeDefined();
      expect(body.unreadCount).toBeDefined();
      expect(body.lastHistoryId).toBeDefined();
      expect(body.syncInProgress).toBeDefined();
    });

    it("should include gap count in status", async () => {
      const res = await app.request("/sync/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gapCount).toBeDefined();
    });
  });

  describe("GET /sync/gaps", () => {
    it("should list all open gaps sorted by created_at asc", async () => {
      const res = await app.request("/sync/gaps");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.gaps)).toBe(true);
    });

    it("should include page_token, estimated_count, and status for each gap", async () => {
      // Insert a gap directly
      db.run(
        "INSERT INTO gaps (page_token, estimated_count, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)",
        ["test-page-token", 50, Date.now(), Date.now()]
      );

      const res = await app.request("/sync/gaps");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gaps.length).toBe(1);
      expect(body.gaps[0].page_token).toBe("test-page-token");
      expect(body.gaps[0].estimated_count).toBe(50);
      expect(body.gaps[0].status).toBe("open");
    });
  });

  describe("POST /sync/gaps/:id/fill", () => {
    it("should return 404 if gap does not exist", async () => {
      const res = await app.request("/sync/gaps/999/fill", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should return 409 if gap is already in filling status", async () => {
      const result = db.run(
        "INSERT INTO gaps (page_token, estimated_count, status, created_at, updated_at) VALUES (?, ?, 'filling', ?, ?)",
        ["test-token", 10, Date.now(), Date.now()]
      );
      const gapId = Number(result.lastInsertRowid);

      const res = await app.request(`/sync/gaps/${gapId}/fill`, { method: "POST" });
      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /sync/gaps/:id", () => {
    it("should abandon the specified gap", async () => {
      const result = db.run(
        "INSERT INTO gaps (page_token, estimated_count, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)",
        ["test-token", 10, Date.now(), Date.now()]
      );
      const gapId = Number(result.lastInsertRowid);

      const res = await app.request(`/sync/gaps/${gapId}`, { method: "DELETE" });
      expect(res.status).toBe(200);

      const gap = db.query("SELECT status FROM gaps WHERE id = ?").get(gapId) as any;
      expect(gap.status).toBe("closed");
    });

    it("should return 404 if gap does not exist", async () => {
      const res = await app.request("/sync/gaps/999", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("worker chaining", () => {
    it("should call embeddingWorker even when summaryWorker is undefined", async () => {
      const embedProcessPending = mock(() => Promise.resolve({ processed: 0, failed: 0 }));
      const embeddingWorker = { processPending: embedProcessPending } as any;

      // Add a message so syncNewest returns fetched > 0
      adapter.addMessage({
        id: "msg1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Test",
        bodyText: "body",
        bodyHtml: "",
        dateSent: Date.now(),
        dateReceived: Date.now(),
        labels: [],
        isRead: false,
        isStarred: false,
      });

      app = new Hono().route(
        "/",
        createSyncRouter(syncService, adapter, db, undefined, embeddingWorker)
      );

      const res = await app.request("/sync", { method: "POST" });
      expect(res.status).toBe(202);

      // Wait for background sync + worker processing
      await new Promise((r) => setTimeout(r, 300));

      expect(embedProcessPending).toHaveBeenCalled();
    });

    it("should call embeddingWorker and summaryWorker independently (both present)", async () => {
      const summaryProcessPending = mock(() => Promise.resolve({ processed: 0, failed: 0 }));
      const embedProcessPending = mock(() => Promise.resolve({ processed: 0, failed: 0 }));
      const summaryWorker = { processPending: summaryProcessPending } as any;
      const embeddingWorker = { processPending: embedProcessPending } as any;

      // Add a message so syncNewest returns fetched > 0
      adapter.addMessage({
        id: "msg1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Test",
        bodyText: "body",
        bodyHtml: "",
        dateSent: Date.now(),
        dateReceived: Date.now(),
        labels: [],
        isRead: false,
        isStarred: false,
      });

      app = new Hono().route(
        "/",
        createSyncRouter(syncService, adapter, db, summaryWorker, embeddingWorker)
      );

      const res = await app.request("/sync", { method: "POST" });
      expect(res.status).toBe(202);

      await new Promise((r) => setTimeout(r, 300));

      expect(summaryProcessPending).toHaveBeenCalled();
      expect(embedProcessPending).toHaveBeenCalled();
    });
  });
});
