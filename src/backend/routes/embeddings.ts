import { Hono } from "hono";
import type { EmbeddingWorker } from "@backend/services/embedding-worker";

export function createEmbeddingsRouter(worker: EmbeddingWorker) {
  const router = new Hono();

  router.get("/embeddings/status", (c) => {
    return c.json(worker.getStatus());
  });

  return router;
}
