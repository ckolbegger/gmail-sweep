import { Hono } from "hono";
import type { EmbeddingWorker } from "@backend/services/embedding-worker";

export function createEmbeddingsRouter(worker: EmbeddingWorker) {
  const router = new Hono();

  router.get("/embeddings/status", (c) => {
    return c.json(worker.getStatus());
  });

  router.post("/embeddings/stop", (c) => {
    worker.stop();
    return c.json({ status: "stopped" });
  });

  router.post("/embeddings/start", (c) => {
    worker.start();
    return c.json({ status: "running" });
  });

  return router;
}
