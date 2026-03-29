import { Hono } from "hono";
import type Database from "bun:sqlite";

const VERSION = "0.1.0";

export function createStatusRouter(db: Database) {
  const router = new Hono();

  router.get("/status", (c) => {
    let databaseStatus = "connected";
    try {
      db.query("SELECT 1").get();
    } catch {
      databaseStatus = "error";
    }

    return c.json({
      status: "ok",
      version: VERSION,
      database: databaseStatus,
    });
  });

  return router;
}
