import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createEmailRouter } from "@backend/routes/emails";
import { Hono } from "hono";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

function createMockAdapter(overrides?: Partial<GmailAdapter>): GmailAdapter {
  return {
    listMessages: mock(() => Promise.resolve({ messages: [], historyId: "0" })),
    getMessage: mock(() => Promise.resolve(null)),
    archive: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    modifyLabels: mock(() => Promise.resolve()),
    listLabels: mock(() => Promise.resolve([])),
    listHistory: mock(() => Promise.resolve({ history: [], historyId: "0" })),
    ...overrides,
  };
}

describe("Email action routes", () => {
  let db: Database;
  let cleanup: () => void;
  let app: Hono;
  let gmailAdapter: GmailAdapter;

  function seedEmails() {
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "m1", "t1", "alice@example.com", '["bob@example.com"]', "First email",
        "Body 1", "", 1000, 1001, '[{"id":"INBOX","name":"INBOX"}]', 0, 0, Date.now()
      ]
    );
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "m2", "t2", "carol@example.com", '["bob@example.com"]', "Second email",
        "Body 2", "", 2000, 2001, '[{"id":"INBOX","name":"INBOX"}]', 1, 0, Date.now()
      ]
    );
  }

  describe("when gmailAdapter is not provided", () => {
    beforeEach(() => {
      ({ db, cleanup } = createTestDb());
      seedEmails();
      app = new Hono().route("/", createEmailRouter({ db }));
    });

    afterEach(() => {
      cleanup();
    });

    it("POST /emails/:id/archive returns 503", async () => {
      const res = await app.request("/emails/m1/archive", { method: "POST" });
      expect(res.status).toBe(503);
    });

    it("POST /emails/:id/delete returns 503", async () => {
      const res = await app.request("/emails/m1/delete", { method: "POST" });
      expect(res.status).toBe(503);
    });

    it("POST /emails/:id/read returns 503", async () => {
      const res = await app.request("/emails/m1/read", { method: "POST" });
      expect(res.status).toBe(503);
    });

    it("POST /emails/:id/unread returns 503", async () => {
      const res = await app.request("/emails/m1/unread", { method: "POST" });
      expect(res.status).toBe(503);
    });
  });

  describe("POST /emails/:id/archive", () => {
    beforeEach(() => {
      ({ db, cleanup } = createTestDb());
      seedEmails();
      gmailAdapter = createMockAdapter();
      app = new Hono().route("/", createEmailRouter({ db, gmailAdapter }));
    });

    afterEach(() => {
      cleanup();
    });

    it("should return 200 on success", async () => {
      const res = await app.request("/emails/m1/archive", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("should call gmailAdapter.archive with the email id", async () => {
      await app.request("/emails/m1/archive", { method: "POST" });
      expect(gmailAdapter.archive).toHaveBeenCalledTimes(1);
      expect(gmailAdapter.archive).toHaveBeenCalledWith("m1");
    });

    it("should remove email from local DB after Gmail confirms success", async () => {
      await app.request("/emails/m1/archive", { method: "POST" });
      const row = db.query("SELECT * FROM emails WHERE id = ?").get("m1");
      expect(row).toBeNull();
    });

    it("should return 404 if email not found locally", async () => {
      const res = await app.request("/emails/nonexistent/archive", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should not remove from DB if Gmail call fails", async () => {
      gmailAdapter.archive = mock(() => Promise.reject(new Error("Gmail API error")));
      const res = await app.request("/emails/m1/archive", { method: "POST" });
      expect(res.status).toBe(502);
      const row = db.query("SELECT * FROM emails WHERE id = ?").get("m1");
      expect(row).not.toBeNull();
    });

    it("should keep other emails intact", async () => {
      await app.request("/emails/m1/archive", { method: "POST" });
      const row = db.query("SELECT * FROM emails WHERE id = ?").get("m2");
      expect(row).not.toBeNull();
    });
  });

  describe("POST /emails/:id/delete", () => {
    beforeEach(() => {
      ({ db, cleanup } = createTestDb());
      seedEmails();
      gmailAdapter = createMockAdapter();
      app = new Hono().route("/", createEmailRouter({ db, gmailAdapter }));
    });

    afterEach(() => {
      cleanup();
    });

    it("should return 200 on success", async () => {
      const res = await app.request("/emails/m1/delete", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("should call gmailAdapter.delete with the email id", async () => {
      await app.request("/emails/m1/delete", { method: "POST" });
      expect(gmailAdapter.delete).toHaveBeenCalledTimes(1);
      expect(gmailAdapter.delete).toHaveBeenCalledWith("m1");
    });

    it("should remove email from local DB after Gmail confirms success", async () => {
      await app.request("/emails/m1/delete", { method: "POST" });
      const row = db.query("SELECT * FROM emails WHERE id = ?").get("m1");
      expect(row).toBeNull();
    });

    it("should return 404 if email not found locally", async () => {
      const res = await app.request("/emails/nonexistent/delete", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should not remove from DB if Gmail call fails", async () => {
      gmailAdapter.delete = mock(() => Promise.reject(new Error("Gmail API error")));
      const res = await app.request("/emails/m1/delete", { method: "POST" });
      expect(res.status).toBe(502);
      const row = db.query("SELECT * FROM emails WHERE id = ?").get("m1");
      expect(row).not.toBeNull();
    });
  });

  describe("POST /emails/:id/read", () => {
    beforeEach(() => {
      ({ db, cleanup } = createTestDb());
      seedEmails();
      gmailAdapter = createMockAdapter();
      app = new Hono().route("/", createEmailRouter({ db, gmailAdapter }));
    });

    afterEach(() => {
      cleanup();
    });

    it("should return 200 on success", async () => {
      const res = await app.request("/emails/m1/read", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("should call modifyLabels removing UNREAD", async () => {
      await app.request("/emails/m1/read", { method: "POST" });
      expect(gmailAdapter.modifyLabels).toHaveBeenCalledTimes(1);
      expect(gmailAdapter.modifyLabels).toHaveBeenCalledWith("m1", {
        addLabelIds: [],
        removeLabelIds: ["UNREAD"],
      });
    });

    it("should set is_read = true locally after Gmail confirms", async () => {
      await app.request("/emails/m1/read", { method: "POST" });
      const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("m1") as any;
      expect(row.is_read).toBe(1);
    });

    it("should return 404 if email not found locally", async () => {
      const res = await app.request("/emails/nonexistent/read", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should not update DB if Gmail call fails", async () => {
      gmailAdapter.modifyLabels = mock(() => Promise.reject(new Error("Gmail API error")));
      const res = await app.request("/emails/m1/read", { method: "POST" });
      expect(res.status).toBe(502);
      const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("m1") as any;
      expect(row.is_read).toBe(0); // unchanged
    });
  });

  describe("POST /emails/:id/unread", () => {
    beforeEach(() => {
      ({ db, cleanup } = createTestDb());
      seedEmails();
      gmailAdapter = createMockAdapter();
      app = new Hono().route("/", createEmailRouter({ db, gmailAdapter }));
    });

    afterEach(() => {
      cleanup();
    });

    it("should return 200 on success", async () => {
      const res = await app.request("/emails/m2/unread", { method: "POST" });
      expect(res.status).toBe(200);
    });

    it("should call modifyLabels adding UNREAD", async () => {
      await app.request("/emails/m2/unread", { method: "POST" });
      expect(gmailAdapter.modifyLabels).toHaveBeenCalledTimes(1);
      expect(gmailAdapter.modifyLabels).toHaveBeenCalledWith("m2", {
        addLabelIds: ["UNREAD"],
        removeLabelIds: [],
      });
    });

    it("should set is_read = false locally after Gmail confirms", async () => {
      await app.request("/emails/m2/unread", { method: "POST" });
      const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("m2") as any;
      expect(row.is_read).toBe(0);
    });

    it("should return 404 if email not found locally", async () => {
      const res = await app.request("/emails/nonexistent/unread", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("should not update DB if Gmail call fails", async () => {
      gmailAdapter.modifyLabels = mock(() => Promise.reject(new Error("Gmail API error")));
      const res = await app.request("/emails/m2/unread", { method: "POST" });
      expect(res.status).toBe(502);
      const row = db.query("SELECT is_read FROM emails WHERE id = ?").get("m2") as any;
      expect(row.is_read).toBe(1); // unchanged
    });
  });
});
