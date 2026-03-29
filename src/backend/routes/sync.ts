import { Hono } from "hono";
import type { SyncService } from "@backend/services/sync";
import type { GmailAdapter } from "@backend/gmail/adapter";
import type Database from "bun:sqlite";

export function createSyncRouter(
  syncService: SyncService,
  adapter: GmailAdapter,
  db: Database
) {
  const router = new Hono();
  let syncInProgress = false;

  router.post("/sync", async (c) => {
    if (syncInProgress) {
      return c.json({ error: "Sync already in progress" }, 409);
    }

    const batchSize = Number(c.req.query("batchSize") ?? 100);

    syncInProgress = true;
    // Run sync in background (don't await)
    syncService.syncNewest(batchSize).finally(() => {
      syncInProgress = false;
    });

    return c.json({ status: "syncing" }, 202);
  });

  router.get("/sync/status", (c) => {
    const status = syncService.getSyncStatus();
    return c.json({
      ...status,
      syncInProgress,
    });
  });

  return router;
}
