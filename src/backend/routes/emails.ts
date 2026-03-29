import { Hono } from "hono";
import type Database from "bun:sqlite";

export function createEmailRouter(db: Database) {
  const router = new Hono();

  router.get("/emails", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const unread = c.req.query("unread");
    const label = c.req.query("label");

    let whereClause = "WHERE 1=1";
    const params: any[] = [];

    if (unread === "true") {
      whereClause += " AND is_read = 0";
    } else if (unread === "false") {
      whereClause += " AND is_read = 1";
    }

    if (label) {
      // Use json_each to match label names exactly
      whereClause +=
        " AND id IN (SELECT e.id FROM emails e, json_each(e.labels) WHERE json_extract(json_each.value, '$.name') = ?)";
      params.push(label);
    }

    const totalRow = db
      .query(`SELECT COUNT(*) as c FROM emails ${whereClause}`)
      .get(...params) as any;

    const emails = db
      .query(
        `SELECT id, thread_id, sender, subject, date_received, is_read, is_starred
         FROM emails ${whereClause}
         ORDER BY date_received DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    return c.json({
      emails: emails.map((e) => ({
        ...e,
        is_read: e.is_read === 1,
        is_starred: e.is_starred === 1,
      })),
      total: totalRow?.c ?? 0,
    });
  });

  router.get("/emails/:id", (c) => {
    const id = c.req.param("id");
    const email = db
      .query("SELECT * FROM emails WHERE id = ?")
      .get(id) as any;

    if (!email) {
      return c.json({ error: "Email not found" }, 404);
    }

    return c.json({
      ...email,
      is_read: email.is_read === 1,
      is_starred: email.is_starred === 1,
      labels: JSON.parse(email.labels || "[]"),
      recipients: JSON.parse(email.recipients || "[]"),
    });
  });

  return router;
}
