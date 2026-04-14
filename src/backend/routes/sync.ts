import { Hono } from "hono";
import type { SyncService } from "@backend/services/sync";
import type { GmailAdapter } from "@backend/gmail/adapter";
import { GapManager } from "@backend/services/gap-manager";
import type { SummaryWorker } from "@backend/services/summary-worker";
import type { EmbeddingWorker } from "@backend/services/embedding-worker";
import type Database from "bun:sqlite";

export function createSyncRouter(
  syncService: SyncService,
  adapter: GmailAdapter,
  db: Database,
  summaryWorker?: SummaryWorker,
  embeddingWorker?: EmbeddingWorker
) {
  const router = new Hono();
  const gapManager = new GapManager(db);
  let syncInProgress = false;

  router.post("/sync", async (c) => {
    if (syncInProgress) {
      return c.json({ error: "Sync already in progress" }, 409);
    }

    const batchSize = Number(c.req.query("batchSize") ?? 100);

    syncInProgress = true;
    syncService.syncNewest(batchSize)
      .then((result) => {
        if (result.fetched > 0) {
          const tasks: Promise<void>[] = [];
          if (summaryWorker) {
            tasks.push(
              summaryWorker.processPending().then(() => {}).catch((err) => {
                console.error("Summary worker error:", err);
              })
            );
          }
          if (embeddingWorker) {
            tasks.push(
              embeddingWorker.processPending().then(() => {}).catch((err) => {
                console.error("Embedding worker error:", err);
              })
            );
          }
          // Run workers in parallel — each has its own try/catch
          Promise.all(tasks);
        }
      })
      .catch((err) => {
        console.error("Sync failed:", err);
      })
      .finally(() => {
        syncInProgress = false;
      });

    return c.json({ status: "syncing" }, 202);
  });

  router.get("/sync/status", (c) => {
    const status = syncService.getSyncStatus();
    const gaps = gapManager.getOpenGaps();
    return c.json({
      ...status,
      gapCount: gaps.length,
      syncInProgress,
    });
  });

  router.get("/sync/gaps", (c) => {
    const gaps = gapManager.getOpenGaps();
    return c.json({ gaps });
  });

  router.post("/sync/gaps/:id/fill", async (c) => {
    const gapId = Number(c.req.param("id"));
    const gap = db.query("SELECT * FROM gaps WHERE id = ?").get(gapId);
    if (!gap) {
      return c.json({ error: "Gap not found" }, 404);
    }
    if ((gap as any).status === "filling") {
      return c.json({ error: "Gap already being filled" }, 409);
    }

    try {
      const result = await gapManager.fillGap(gapId, adapter);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  router.delete("/sync/gaps/:id", (c) => {
    const gapId = Number(c.req.param("id"));
    const gap = db.query("SELECT * FROM gaps WHERE id = ?").get(gapId);
    if (!gap) {
      return c.json({ error: "Gap not found" }, 404);
    }
    gapManager.abandonGap(gapId);
    return c.json({ success: true });
  });

  return router;
}
