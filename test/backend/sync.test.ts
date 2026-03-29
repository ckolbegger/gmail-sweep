import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SyncService } from "@backend/services/sync";
import { MockGmailAdapter } from "@backend/gmail/mock";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

describe("Sync service (basic)", () => {
  let db: Database;
  let cleanup: () => void;
  let adapter: MockGmailAdapter;
  let service: SyncService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    adapter = new MockGmailAdapter();
    service = new SyncService(db, adapter);
  });

  afterEach(() => {
    cleanup();
  });

  describe("syncNewest", () => {
    it("should fetch batchSize emails from Gmail via messages.list with labelIds=[INBOX]", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [{ id: "INBOX", name: "INBOX" }],
        isRead: false,
        isStarred: false,
      });

      const result = await service.syncNewest(100);
      expect(result.fetched).toBe(1);
    });

    it("should upsert fetched emails into the database", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [{ id: "INBOX", name: "INBOX" }],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const row = db.query("SELECT * FROM emails WHERE id = 'm1'").get() as any;
      expect(row).not.toBeNull();
      expect(row.subject).toBe("Hello");
    });

    it("should skip emails already in the database", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const result = await service.syncNewest(100);
      expect(result.skipped).toBe(1);
    });

    it("should store labels as JSON with id and name", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [{ id: "INBOX", name: "INBOX" }, { id: "STARRED", name: "Starred" }],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const row = db.query("SELECT labels FROM emails WHERE id = 'm1'").get() as any;
      const labels = JSON.parse(row.labels);
      expect(labels).toHaveLength(2);
      expect(labels[0].id).toBe("INBOX");
    });

    it("should return the count of newly fetched emails", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello 1",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });
      adapter.addMessage({
        id: "m2",
        threadId: "t2",
        sender: "x@y.com",
        recipients: ["c@d.com"],
        subject: "Hello 2",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 2000,
        dateReceived: 2001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      const result = await service.syncNewest(100);
      expect(result.fetched).toBe(2);
    });

    it("should store historyId from the Gmail response into sync_state", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const status = service.getSyncStatus();
      expect(status.lastHistoryId).toBeDefined();
    });

    it("should handle Gmail API errors gracefully without crashing", async () => {
      const failingAdapter = {
        listMessages: async () => { throw new Error("API error"); },
      } as any;
      const failingService = new SyncService(db, failingAdapter);

      await expect(failingService.syncNewest(100)).rejects.toThrow("API error");
      // DB should still be intact
      const count = (db.query("SELECT COUNT(*) as c FROM emails").get() as any).c;
      expect(count).toBe(0);
    });
  });

  describe("getSyncStatus", () => {
    it("should return total stored email count", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const status = service.getSyncStatus();
      expect(status.totalEmails).toBe(1);
    });

    it("should return unread email count", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const status = service.getSyncStatus();
      expect(status.unreadCount).toBe(1);
    });

    it("should return last_history_id from sync_state", async () => {
      adapter.addMessage({
        id: "m1",
        threadId: "t1",
        sender: "a@b.com",
        recipients: ["c@d.com"],
        subject: "Hello",
        bodyText: "World",
        bodyHtml: "",
        dateSent: 1000,
        dateReceived: 1001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      await service.syncNewest(100);
      const status = service.getSyncStatus();
      expect(status.lastHistoryId).toBeDefined();
    });
  });
});
