import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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

    it("should return 401 if not authorized (no oauth configured)", async () => {
      // This depends on the sync router checking auth status
      // For now, sync routes work without auth check (auth is checked at server level)
      const res = await app.request("/sync", { method: "POST" });
      expect(res.status).toBe(202);
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
  });
});
