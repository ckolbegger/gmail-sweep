import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createEmailRouter } from "@backend/routes/emails";
import { Hono } from "hono";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

describe("Email routes", () => {
  let db: Database;
  let cleanup: () => void;
  let app: Hono;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    app = new Hono().route("/", createEmailRouter({ db }));

    // Seed test data
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
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "m3", "t3", "dave@example.com", '["bob@example.com"]', "Third email",
        "Body 3", "", 3000, 3001, '[{"id":"IMPORTANT","name":"Important"}]', 0, 1, Date.now()
      ]
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe("GET /emails", () => {
    it("should return a paginated list of emails ordered by date_received desc", async () => {
      const res = await app.request("/emails");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emails).toHaveLength(3);
      expect(body.emails[0].id).toBe("m3"); // newest first
    });

    it("should support a limit query parameter (default 50)", async () => {
      const res = await app.request("/emails?limit=1");
      const body = await res.json();
      expect(body.emails).toHaveLength(1);
    });

    it("should support an offset query parameter", async () => {
      const res = await app.request("/emails?limit=1&offset=1");
      const body = await res.json();
      expect(body.emails[0].id).toBe("m2");
    });

    it("should support filtering by is_read (unread=true/false)", async () => {
      const res = await app.request("/emails?unread=true");
      const body = await res.json();
      expect(body.emails).toHaveLength(2);
      expect(body.emails.every((e: any) => e.is_read === false)).toBe(true);
    });

    it("should support filtering by label name", async () => {
      const res = await app.request("/emails?label=INBOX");
      const body = await res.json();
      expect(body.emails).toHaveLength(2);
    });

    it("should not false-match on label substrings", async () => {
      const res = await app.request("/emails?label=INBO");
      const body = await res.json();
      expect(body.emails).toHaveLength(0);
    });

    it("should return id, sender, subject, date_received, is_read, is_starred per email", async () => {
      const res = await app.request("/emails?limit=1");
      const body = await res.json();
      const email = body.emails[0];
      expect(email.id).toBeDefined();
      expect(email.sender).toBeDefined();
      expect(email.subject).toBeDefined();
      expect(email.date_received).toBeDefined();
      expect(email.is_read).toBeDefined();
      expect(email.is_starred).toBeDefined();
    });

    it("should return total count in a response header or metadata field", async () => {
      const res = await app.request("/emails");
      const body = await res.json();
      expect(body.total).toBe(3);
    });
  });

  describe("GET /emails/:id", () => {
    it("should return full email details including body_text", async () => {
      const res = await app.request("/emails/m1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.body_text).toBe("Body 1");
      expect(body.subject).toBe("First email");
    });

    it("should return 404 for non-existent email", async () => {
      const res = await app.request("/emails/nonexistent");
      expect(res.status).toBe(404);
    });

    it("should include AI fields: ai_status, summary, action_items, key_points", async () => {
      db.run(
        `UPDATE emails SET ai_status = 'done', summary = 'Test summary', action_items = '["Do X"]', key_points = '["Y is important"]' WHERE id = 'm1'`
      );
      const res = await app.request("/emails/m1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ai_status).toBe("done");
      expect(body.summary).toBe("Test summary");
      expect(body.action_items).toEqual(["Do X"]);
      expect(body.key_points).toEqual(["Y is important"]);
    });

    it("should include ai_status as pending when no AI processing done", async () => {
      const res = await app.request("/emails/m1");
      const body = await res.json();
      expect(body.ai_status).toBe("pending");
    });
  });

  describe("GET /emails (AI fields)", () => {
    it("should include ai_status in list response", async () => {
      db.run(`UPDATE emails SET ai_status = 'done' WHERE id = 'm1'`);
      const res = await app.request("/emails");
      const body = await res.json();
      const m1 = body.emails.find((e: any) => e.id === "m1");
      expect(m1.ai_status).toBe("done");
      const m2 = body.emails.find((e: any) => e.id === "m2");
      expect(m2.ai_status).toBe("pending");
    });
  });

  describe("GET /emails (removed_state filter)", () => {
    it("should exclude emails with removed_state = 'archived'", async () => {
      db.run(`UPDATE emails SET removed_state = 'archived' WHERE id = 'm1'`);
      const res = await app.request("/emails");
      const body = await res.json();
      expect(body.emails).toHaveLength(2);
      expect(body.emails.find((e: any) => e.id === "m1")).toBeUndefined();
    });

    it("should exclude emails with removed_state = 'deleted'", async () => {
      db.run(`UPDATE emails SET removed_state = 'deleted' WHERE id = 'm2'`);
      const res = await app.request("/emails");
      const body = await res.json();
      expect(body.emails).toHaveLength(2);
      expect(body.emails.find((e: any) => e.id === "m2")).toBeUndefined();
    });

    it("should exclude all removed emails and adjust total", async () => {
      db.run(`UPDATE emails SET removed_state = 'archived' WHERE id = 'm1'`);
      db.run(`UPDATE emails SET removed_state = 'deleted' WHERE id = 'm3'`);
      const res = await app.request("/emails");
      const body = await res.json();
      expect(body.emails).toHaveLength(1);
      expect(body.total).toBe(1);
    });
  });
});
