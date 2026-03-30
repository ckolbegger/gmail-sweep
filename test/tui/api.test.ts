import { describe, it, expect, afterEach } from "bun:test";
import { createApp } from "@backend/server";
import { createTestDb } from "@test/helpers/test-db";
import { ApiClient } from "../../src/tui/api";
import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

function createMockAdapter(): GmailAdapter {
  return {
    listMessages: async () => ({ messages: [], historyId: "0" }),
    getMessage: async () => null,
    archive: async () => {},
    delete: async () => {},
    modifyLabels: async () => {},
    listLabels: async () => [],
    listHistory: async () => ({ history: [], historyId: "0" }),
  };
}

describe("TUI API client", () => {
  let db: Database;
  let cleanup: () => void;
  let client: ApiClient;
  let server: any;

  afterEach(() => {
    if (server) server.stop();
    if (cleanup) cleanup();
  });

  function setup(adapter?: GmailAdapter) {
    const result = createTestDb();
    db = result.db;
    cleanup = result.cleanup;
    const app = createApp({ db, gmailAdapter: adapter });
    server = Bun.serve({ port: 0, fetch: app.fetch });
    client = new ApiClient(`http://127.0.0.1:${server.port}`);
  }

  function insertEmail(id: string, isRead: number) {
    const now = Date.now();
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '[]', ?, 0, ?)`,
      [id, "t1", "a@b.com", "[]", "Test", "body", now, now, isRead, now]
    );
  }

  it("should mark an email as read", async () => {
    setup(createMockAdapter());
    insertEmail("e1", 0);
    await client.markRead("e1");
    const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("e1") as any;
    expect(row.is_read).toBe(1);
  });

  it("should mark an email as unread", async () => {
    setup(createMockAdapter());
    insertEmail("e1", 1);
    await client.markUnread("e1");
    const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("e1") as any;
    expect(row.is_read).toBe(0);
  });

  it("should return error for archive without gmail adapter", async () => {
    setup();
    insertEmail("e1", 0);
    await expect(client.archiveEmail("e1")).rejects.toThrow();
  });

  it("should trigger a sync", async () => {
    setup(createMockAdapter());
    const result = await client.triggerSync(10);
    expect(result.status).toBe("syncing");
  });

  it("should get sync status with gapCount", async () => {
    setup(createMockAdapter());
    const status = await client.getSyncStatus();
    expect(status).toHaveProperty("totalEmails");
    expect(status).toHaveProperty("unreadCount");
    expect(status).toHaveProperty("syncInProgress");
    expect(status).toHaveProperty("gapCount");
  });
});
