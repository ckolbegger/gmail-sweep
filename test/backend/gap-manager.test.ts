import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type Database from "bun:sqlite";
import { GapManager, type Gap, type FillResult } from "@backend/services/gap-manager";
import { MockGmailAdapter } from "@backend/gmail/mock";
import { createTestDb } from "@test/helpers/test-db";

describe("GapManager", () => {
  let db: Database;
  let cleanup: () => void;
  let gm: GapManager;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    gm = new GapManager(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe("createGap", () => {
    it("should store pageToken with status open and return the gap id", () => {
      const id = gm.createGap("token-abc", 42);
      expect(id).toBeGreaterThan(0);

      const row = db
        .query("SELECT * FROM gaps WHERE id = ?")
        .get(id) as any;
      expect(row).not.toBeNull();
      expect(row.page_token).toBe("token-abc");
      expect(row.estimated_count).toBe(42);
      expect(row.status).toBe("open");
    });

    it("should store gap without estimated_count", () => {
      const id = gm.createGap("token-no-est");
      const row = db
        .query("SELECT * FROM gaps WHERE id = ?")
        .get(id) as any;
      expect(row.page_token).toBe("token-no-est");
      expect(row.estimated_count).toBeNull();
      expect(row.status).toBe("open");
    });

    it("should set created_at and updated_at", () => {
      const before = Date.now();
      const id = gm.createGap("token-ts");
      const after = Date.now();
      const row = db
        .query("SELECT * FROM gaps WHERE id = ?")
        .get(id) as any;
      expect(row.created_at).toBeGreaterThanOrEqual(before);
      expect(row.created_at).toBeLessThanOrEqual(after);
      expect(row.updated_at).toBe(row.created_at);
    });
  });

  describe("getNextGapToFill", () => {
    it("should return the oldest open gap by created_at", () => {
      // Insert gaps with controlled timestamps
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-newer", "open", 2000, 2000]
      );
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-older", "open", 1000, 1000]
      );

      const gap = gm.getNextGapToFill();
      expect(gap).not.toBeNull();
      expect(gap!.page_token).toBe("tok-older");
    });

    it("should return null when no open gaps exist", () => {
      expect(gm.getNextGapToFill()).toBeNull();
    });

    it("should skip gaps with status filling", () => {
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-filling", "filling", 1000, 1000]
      );

      expect(gm.getNextGapToFill()).toBeNull();
    });

    it("should skip gaps with status closed", () => {
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-closed", "closed", 1000, 1000]
      );

      expect(gm.getNextGapToFill()).toBeNull();
    });
  });

  describe("fillGap", () => {
    it("should set status to filling, call messages.list with pageToken, and close gap when no nextPageToken", async () => {
      const adapter = new MockGmailAdapter();
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

      const gapId = gm.createGap("tok-close");

      const result: FillResult = await gm.fillGap(gapId, adapter);

      // Gap should be closed
      const row = db
        .query("SELECT status FROM gaps WHERE id = ?")
        .get(gapId) as any;
      expect(row.status).toBe("closed");

      // Should have fetched messages
      expect(result.fetched).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("should update page_token when response has nextPageToken", async () => {
      const adapter = new MockGmailAdapter();
      // Add a message and configure listMessages to return nextPageToken
      const originalList = adapter.listMessages.bind(adapter);
      adapter.listMessages = async (params) => {
        const base = await originalList(params);
        return { ...base, nextPageToken: "next-tok-123" };
      };

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

      const gapId = gm.createGap("tok-update");

      await gm.fillGap(gapId, adapter);

      // Gap should remain open with updated page_token
      const row = db
        .query("SELECT status, page_token FROM gaps WHERE id = ?")
        .get(gapId) as any;
      expect(row.status).toBe("open");
      expect(row.page_token).toBe("next-tok-123");
    });

    it("should return gap to open on adapter failure", async () => {
      const adapter = new MockGmailAdapter();
      adapter.listMessages = async () => {
        throw new Error("API failure");
      };

      const gapId = gm.createGap("tok-fail");

      await expect(gm.fillGap(gapId, adapter)).rejects.toThrow("API failure");

      // Gap should be back to open
      const row = db
        .query("SELECT status FROM gaps WHERE id = ?")
        .get(gapId) as any;
      expect(row.status).toBe("open");
    });

    it("should dedup via INSERT OR IGNORE (skip already-stored emails)", async () => {
      const adapter = new MockGmailAdapter();
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

      // Pre-insert the email
      db.run(
        `INSERT OR IGNORE INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["m1", "t1", "a@b.com", "[]", "Hello", "World", "", 1000, 1001, "[]", 0, 0, Date.now()]
      );

      const gapId = gm.createGap("tok-dedup");
      const result = await gm.fillGap(gapId, adapter);

      expect(result.skipped).toBe(1);
      expect(result.fetched).toBe(0);
    });

    it("should skip if gap is already filling", async () => {
      const adapter = new MockGmailAdapter();
      let listCalled = false;
      adapter.listMessages = async () => {
        listCalled = true;
        return { messages: [], historyId: "1" };
      };

      const gapId = gm.createGap("tok-already");
      db.run("UPDATE gaps SET status = 'filling' WHERE id = ?", [gapId]);

      const result = await gm.fillGap(gapId, adapter);
      expect(listCalled).toBe(false);
      expect(result.fetched).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe("abandonGap", () => {
    it("should set gap status to closed", () => {
      const gapId = gm.createGap("tok-abandon");
      gm.abandonGap(gapId);

      const row = db
        .query("SELECT status FROM gaps WHERE id = ?")
        .get(gapId) as any;
      expect(row.status).toBe("closed");
    });
  });

  describe("getOpenGaps", () => {
    it("should return all open gaps sorted by created_at asc", () => {
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-b", "open", 2000, 2000]
      );
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-a", "open", 1000, 1000]
      );
      db.run(
        "INSERT INTO gaps (page_token, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["tok-c", "closed", 3000, 3000]
      );

      const gaps = gm.getOpenGaps();
      expect(gaps).toHaveLength(2);
      expect(gaps[0].page_token).toBe("tok-a");
      expect(gaps[1].page_token).toBe("tok-b");
    });

    it("should return empty array when no open gaps", () => {
      expect(gm.getOpenGaps()).toEqual([]);
    });
  });
});
