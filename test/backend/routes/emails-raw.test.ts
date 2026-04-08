import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createEmailRouter } from "@backend/routes/emails";
import { Hono } from "hono";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

function createMockAdapter(overrides?: Partial<GmailAdapter>): GmailAdapter {
  return {
    listMessages: async () => ({ messages: [], historyId: "1" }),
    getMessage: async () => null,
    archive: async () => {},
    delete: async () => {},
    modifyLabels: async () => {},
    listLabels: async () => [],
    listHistory: async () => ({ history: [], historyId: "1" }),
    ...overrides,
  };
}

const stubMessage = {
  id: "gmail123",
  threadId: "thread123",
  sender: "sender@example.com",
  recipients: ["me@example.com"],
  subject: "Raw subject",
  bodyText: "Plain text body",
  bodyHtml: "<p>HTML body</p>",
  dateSent: 1000,
  dateReceived: 1001,
  labels: [{ id: "INBOX", name: "INBOX" }],
  isRead: false,
  isStarred: false,
};

describe("GET /emails/:id/raw", () => {
  let db: Database;
  let cleanup: () => void;
  let app: Hono;
  let mockAdapter: GmailAdapter;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    mockAdapter = createMockAdapter({
      getMessage: async () => stubMessage,
    });
    app = new Hono().route("/", createEmailRouter({ db, gmailAdapter: mockAdapter }));
  });

  afterEach(() => {
    cleanup();
  });

  it("should return 503 when gmailAdapter is not configured", async () => {
    const localApp = new Hono().route("/", createEmailRouter({ db }));
    const res = await localApp.request("/emails/abc123/raw");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Gmail adapter not configured");
  });

  it("should fetch message from Gmail and return bodyText and bodyHtml", async () => {
    const res = await app.request("/emails/gmail123/raw");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bodyText).toBe("Plain text body");
    expect(body.bodyHtml).toBe("<p>HTML body</p>");
    expect(body.subject).toBe("Raw subject");
    expect(body.sender).toBe("sender@example.com");
  });

  it("should return 404 when Gmail returns null", async () => {
    mockAdapter.getMessage = async () => null;
    const res = await app.request("/emails/nonexistent/raw");
    expect(res.status).toBe(404);
  });

  it("should not touch the database", async () => {
    // No row in DB for this id, but endpoint still returns data from Gmail
    const res = await app.request("/emails/gmail123/raw");
    expect(res.status).toBe(200);

    // Confirm nothing was written to DB
    const row = db.query("SELECT id FROM emails WHERE id = ?").get("gmail123");
    expect(row).toBeNull();
  });

  it("should return all GmailMessage fields", async () => {
    const res = await app.request("/emails/gmail123/raw");
    const body = await res.json();
    expect(body.id).toBe("gmail123");
    expect(body.threadId).toBe("thread123");
    expect(body.recipients).toEqual(["me@example.com"]);
    expect(body.dateSent).toBe(1000);
    expect(body.dateReceived).toBe(1001);
    expect(body.labels).toEqual([{ id: "INBOX", name: "INBOX" }]);
    expect(body.isRead).toBe(false);
    expect(body.isStarred).toBe(false);
  });
});
