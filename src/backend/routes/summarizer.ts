import { Hono } from "hono";
import type { SummaryWorker } from "@backend/services/summary-worker";

export function createSummarizerRouter(worker: SummaryWorker) {
  const router = new Hono();

  router.get("/summarizer/status", (c) => {
    return c.json({ pending: worker.getQueueDepth() });
  });

  return router;
}
