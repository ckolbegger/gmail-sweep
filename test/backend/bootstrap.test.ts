import { describe, it, expect, mock } from "bun:test";
import { startBackgroundWorkers } from "@backend/bootstrap";

describe("startBackgroundWorkers", () => {
  it("starts the summary worker", () => {
    const summaryWorker = { start: mock(() => {}) };
    const embeddingWorker = { start: mock(() => {}) };
    startBackgroundWorkers({ summaryWorker, embeddingWorker } as any);
    expect(summaryWorker.start).toHaveBeenCalledTimes(1);
  });

  it("starts the embedding worker (regression: index.ts used to start only the summary worker)", () => {
    const summaryWorker = { start: mock(() => {}) };
    const embeddingWorker = { start: mock(() => {}) };
    startBackgroundWorkers({ summaryWorker, embeddingWorker } as any);
    expect(embeddingWorker.start).toHaveBeenCalledTimes(1);
  });

  it("passes the interval to both workers", () => {
    const summaryWorker = { start: mock(() => {}) };
    const embeddingWorker = { start: mock(() => {}) };
    startBackgroundWorkers({ summaryWorker, embeddingWorker } as any, 30_000);
    expect(summaryWorker.start).toHaveBeenCalledWith(30_000);
    expect(embeddingWorker.start).toHaveBeenCalledWith(30_000);
  });

  it("defaults the interval to 60s when omitted", () => {
    const summaryWorker = { start: mock(() => {}) };
    const embeddingWorker = { start: mock(() => {}) };
    startBackgroundWorkers({ summaryWorker, embeddingWorker } as any);
    expect(summaryWorker.start).toHaveBeenCalledWith(60_000);
    expect(embeddingWorker.start).toHaveBeenCalledWith(60_000);
  });
});
