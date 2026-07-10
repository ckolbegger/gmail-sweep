import { test, expect, mock } from "bun:test";
import { startBackgroundWorkers } from "@backend/start-workers";

const makeWorker = () => ({ start: mock(() => {}), stop: mock(() => {}) });

test("startBackgroundWorkers starts the embedding worker on boot", () => {
  const embeddingWorker = makeWorker();
  startBackgroundWorkers({ embeddingWorker } as any, 60000);
  expect(embeddingWorker.start).toHaveBeenCalledTimes(1);
  expect(embeddingWorker.start).toHaveBeenCalledWith(60000);
});

test("startBackgroundWorkers starts both summary and embedding workers", () => {
  const summaryWorker = makeWorker();
  const embeddingWorker = makeWorker();
  startBackgroundWorkers({ summaryWorker, embeddingWorker } as any, 60000);
  expect(summaryWorker.start).toHaveBeenCalledWith(60000);
  expect(embeddingWorker.start).toHaveBeenCalledWith(60000);
});

test("startBackgroundWorkers is a no-op when no workers are provided", () => {
  expect(() => startBackgroundWorkers({}, 60000)).not.toThrow();
});
