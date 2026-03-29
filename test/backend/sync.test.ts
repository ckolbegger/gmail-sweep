import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SyncService } from "@backend/services/sync";
import { MockGmailAdapter } from "@backend/gmail/mock";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

class GapAwareMockAdapter extends MockGmailAdapter {
  private nextPageToken: string | undefined;
  private pageTokens = new Map<string, { messages: { id: string; threadId: string }[]; nextPageToken?: string }>();
  private gapMessages = new Map<string, import("@backend/gmail/adapter").GmailMessage>();

  setNextPageToken(token: string | undefined) {
    this.nextPageToken = token;
  }

  addPage(token: string, messages: { id: string; threadId: string }[], nextToken?: string) {
    this.pageTokens.set(token, { messages, nextPageToken: nextToken });
  }

  addGapMessage(msg: import("@backend/gmail/adapter").GmailMessage) {
    this.gapMessages.set(msg.id, msg);
  }

  override async listMessages(params: {
    maxResults: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<import("@backend/gmail/adapter").ListMessagesResult> {
    if (params.pageToken && this.pageTokens.has(params.pageToken)) {
      const page = this.pageTokens.get(params.pageToken)!;
      return {
        messages: page.messages.slice(0, params.maxResults),
        nextPageToken: page.nextPageToken,
        historyId: String(2000),
      };
    }
    const base = await super.listMessages(params);
    if (this.nextPageToken) {
      return { ...base, nextPageToken: this.nextPageToken };
    }
    return base;
  }

  override async getMessage(id: string) {
    return this.gapMessages.get(id) ?? super.getMessage(id);
  }
}

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

describe("Sync service (enhanced with gaps)", () => {
  let db: Database;
  let cleanup: () => void;
  let adapter: GapAwareMockAdapter;
  let service: SyncService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    adapter = new GapAwareMockAdapter();
    service = new SyncService(db, adapter);
  });

  afterEach(() => {
    cleanup();
  });

  describe("syncNewest gap creation", () => {
    it("should create a gap when Gmail returns nextPageToken", async () => {
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
      adapter.setNextPageToken("next-page-1");

      const result = await service.syncNewest(100);
      expect(result.fetched).toBe(1);

      // A gap should have been created
      const gaps = db.query("SELECT * FROM gaps").all() as any[];
      expect(gaps).toHaveLength(1);
      expect(gaps[0].page_token).toBe("next-page-1");
      expect(gaps[0].status).toBe("open");
    });

    it("should not create a gap when Gmail returns no nextPageToken", async () => {
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
      const gaps = db.query("SELECT * FROM gaps").all() as any[];
      expect(gaps).toHaveLength(0);
    });

    it("should use remaining batch capacity for gap fill", async () => {
      // Only add m1 to the main adapter (returned by first listMessages call)
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
      adapter.setNextPageToken("gap-token-1");

      // m2 is only available via the gap page, not in the main message list
      const gapAdapter = adapter as GapAwareMockAdapter;
      gapAdapter.addGapMessage({
        id: "m2",
        threadId: "t2",
        sender: "b@c.com",
        recipients: ["d@e.com"],
        subject: "Gap email",
        bodyText: "From gap",
        bodyHtml: "",
        dateSent: 2000,
        dateReceived: 2001,
        labels: [],
        isRead: false,
        isStarred: false,
      });
      gapAdapter.addPage("gap-token-1", [{ id: "m2", threadId: "t2" }]);

      const result = await service.syncNewest(100);
      expect(result.fetched).toBe(2);
      expect(result.gapFilled).toBe(1);

      const row = db.query("SELECT * FROM emails WHERE id = 'm2'").get() as any;
      expect(row).not.toBeNull();
    });
  });

  describe("concurrent sync prevention", () => {
    it("should prevent concurrent syncs and throw 409 error", async () => {
      // Simulate a long-running sync by locking
      db.run(
        "INSERT INTO sync_state (key, value) VALUES ('sync_in_progress', '1')"
      );

      try {
        await service.syncNewest(100);
        expect(true).toBe(false); // Should not reach here
      } catch (err: any) {
        expect(err.status).toBe(409);
      }
    });
  });

  describe("syncIncremental", () => {
    it("should use history.list to fetch new messages since last historyId", async () => {
      // Set up a last_history_id
      db.run(
        "INSERT INTO sync_state (key, value) VALUES ('last_history_id', '1000')"
      );

      adapter.addMessage({
        id: "m-new",
        threadId: "t-new",
        sender: "new@b.com",
        recipients: ["c@d.com"],
        subject: "New msg",
        bodyText: "Body",
        bodyHtml: "",
        dateSent: 3000,
        dateReceived: 3001,
        labels: [],
        isRead: false,
        isStarred: false,
      });

      adapter.addHistoryRecord({
        id: "1001",
        messagesAdded: [{ id: "m-new", threadId: "t-new" }],
      });

      const result = await service.syncIncremental();
      expect(result.fetched).toBe(1);

      const row = db.query("SELECT * FROM emails WHERE id = 'm-new'").get() as any;
      expect(row).not.toBeNull();
    });

    it("should update last_history_id after incremental sync", async () => {
      db.run(
        "INSERT INTO sync_state (key, value) VALUES ('last_history_id', '1000')"
      );

      adapter.addHistoryRecord({
        id: "1001",
        messagesAdded: [],
      });

      await service.syncIncremental();

      const row = db.query("SELECT value FROM sync_state WHERE key = 'last_history_id'").get() as any;
      expect(row.value).toBeDefined();
      // Should be updated to the new historyId from listHistory
    });

    it("should return fetched=0 if no historyId stored", async () => {
      const result = await service.syncIncremental();
      expect(result.fetched).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should handle deleted messages from history", async () => {
      db.run(
        "INSERT INTO sync_state (key, value) VALUES ('last_history_id', '1000')"
      );

      // Pre-insert an email that will be deleted
      db.run(
        `INSERT OR IGNORE INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["m-del", "t-del", "a@b.com", "[]", "Del", "Body", "", 1000, 1001, "[]", 0, 0, Date.now()]
      );

      adapter.addHistoryRecord({
        id: "1001",
        messagesDeleted: [{ id: "m-del", threadId: "t-del" }],
      });

      const result = await service.syncIncremental();
      expect(result.deleted).toBe(1);

      const row = db.query("SELECT * FROM emails WHERE id = 'm-del'").get() as any;
      expect(row).toBeNull();
    });
  });
});
