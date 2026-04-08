import { Hono } from "hono";
import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

export function createEmailRouter(deps: { db: Database; gmailAdapter?: GmailAdapter }) {
  const { db, gmailAdapter } = deps;
  const router = new Hono();

  router.get("/emails", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Number(c.req.query("offset") ?? 0);
    const unread = c.req.query("unread");
    const label = c.req.query("label");

    let whereClause = "WHERE removed_state IS NULL";
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
        `SELECT id, thread_id, sender, subject, date_received, is_read, is_starred, ai_status
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
      action_items: email.action_items ? JSON.parse(email.action_items) : null,
      key_points: email.key_points ? JSON.parse(email.key_points) : null,
    });
  });

  // Helper: require gmailAdapter or return 503
  const requireAdapter = (c: any) => {
    if (!gmailAdapter) {
      return c.json({ error: "Gmail adapter not configured" }, 503);
    }
    return null;
  };

  // Helper: find email or return 404
  const findEmail = (c: any) => {
    const id = c.req.param("id");
    const email = db.query("SELECT id FROM emails WHERE id = ?").get(id);
    if (!email) {
      return { error: c.json({ error: "Email not found" }, 404) as any, email: null };
    }
    return { error: null, email };
  };

  router.post("/emails/:id/archive", async (c) => {
    const adapterError = requireAdapter(c);
    if (adapterError) return adapterError;

    const { error, email } = findEmail(c);
    if (error) return error;

    const id = c.req.param("id");
    db.run("UPDATE emails SET removed_state = 'archived' WHERE id = ?", [id]);

    // Fire-and-forget Gmail API call; rollback on failure
    gmailAdapter!.archive(id).catch(() => {
      db.run("UPDATE emails SET removed_state = NULL WHERE id = ?", [id]);
    });

    return c.json({ success: true });
  });

  router.post("/emails/:id/delete", async (c) => {
    const adapterError = requireAdapter(c);
    if (adapterError) return adapterError;

    const { error, email } = findEmail(c);
    if (error) return error;

    const id = c.req.param("id");
    db.run("UPDATE emails SET removed_state = 'deleted' WHERE id = ?", [id]);

    // Fire-and-forget Gmail API call; rollback on failure
    gmailAdapter!.delete(id).catch(() => {
      db.run("UPDATE emails SET removed_state = NULL WHERE id = ?", [id]);
    });

    return c.json({ success: true });
  });

  router.post("/emails/:id/read", async (c) => {
    const adapterError = requireAdapter(c);
    if (adapterError) return adapterError;

    const { error, email } = findEmail(c);
    if (error) return error;

    const id = c.req.param("id");
    try {
      await gmailAdapter!.modifyLabels(id, { addLabelIds: [], removeLabelIds: ["UNREAD"] });
    } catch {
      return c.json({ error: "Gmail API error" }, 502);
    }
    db.run("UPDATE emails SET is_read = 1 WHERE id = ?", [id]);
    return c.json({ success: true });
  });

  router.post("/emails/:id/unread", async (c) => {
    const adapterError = requireAdapter(c);
    if (adapterError) return adapterError;

    const { error, email } = findEmail(c);
    if (error) return error;

    const id = c.req.param("id");
    try {
      await gmailAdapter!.modifyLabels(id, { addLabelIds: ["UNREAD"], removeLabelIds: [] });
    } catch {
      return c.json({ error: "Gmail API error" }, 502);
    }
    db.run("UPDATE emails SET is_read = 0 WHERE id = ?", [id]);
    return c.json({ success: true });
  });

  return router;
}
