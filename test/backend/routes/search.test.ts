import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSearchRouter } from "@backend/routes/search";
import { SearchService } from "@backend/services/search";
import { Hono } from "hono";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

describe("Search routes", () => {
  let db: Database;
  let cleanup: () => void;
  let app: Hono;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    const searchService = new SearchService(db);
    app = new Hono().route("/", createSearchRouter(searchService));

    const now = Date.now();
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '[{"id":"INBOX","name":"INBOX"}]', ?, ?, ?, ?)`,
      ["m1", "t1", "alice@example.com", '["bob@example.com"]', "Meeting request",
       "Let's meet", now - 1000, now - 1000, 0, 0, Date.now(), "Meeting invite"]
    );
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '[{"id":"INBOX","name":"INBOX"}]', ?, ?, ?, ?)`,
      ["m2", "t2", "carol@example.com", '["bob@example.com"]', "Project update",
       "The project is done", now - 2000, now - 2000, 1, 0, Date.now(), "Status update"]
    );
    db.run(
      `INSERT INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '[{"id":"IMPORTANT","name":"Important"}]', ?, ?, ?, ?)`,
      ["m3", "t3", "dave@example.com", '["bob@example.com"]', "Urgent meeting",
       "Meet now", now - 500, now - 500, 0, 1, Date.now(), "Urgent meeting request"]
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("POST /search accepts a query string and returns matched emails", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "is:unread" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("returns results with all expected fields", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "from:alice" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const r = body.results[0];
    expect(r.id).toBeDefined();
    expect(r.sender).toBeDefined();
    expect(r.subject).toBeDefined();
    expect(r.date_received).toBeDefined();
    expect(r.is_read).toBeDefined();
    expect(r.is_starred).toBeDefined();
    expect(r.score).toBeDefined();
  });

  it("supports the limit query parameter (default 50)", async () => {
    // Default limit
    const res1 = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    const body1 = await res1.json();
    expect(body1.results.length).toBeLessThanOrEqual(50);

    // Custom limit
    const res2 = await app.request("/search?limit=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    const body2 = await res2.json();
    expect(body2.results).toHaveLength(1);
  });

  it("caps limit at 200", async () => {
    const res = await app.request("/search?limit=500", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(200);
    // Should still return results, just capped at 200
    const body = await res.json();
    expect(body.results.length).toBeLessThanOrEqual(200);
  });

  it("returns 400 if query is missing", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 if query is empty string", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("handles operator-only queries without vector search", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "is:starred" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("m3");
    expect(body.results[0].score).toBeNull();
  });

  it("returns results ordered by date_received desc for SQL-only search", async () => {
    const res = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    const body = await res.json();
    expect(body.results[0].id).toBe("m3"); // most recent
    expect(body.results[2].id).toBe("m2"); // oldest
  });
});
