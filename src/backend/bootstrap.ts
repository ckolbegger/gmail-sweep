/**
 * Background-worker startup. Extracted from index.ts so the wiring is unit-testable.
 */
export interface WorkerControl {
  start(intervalMs: number): void;
}

export interface WorkerStartupDeps {
  summaryWorker: WorkerControl;
  embeddingWorker: WorkerControl;
}

export function startBackgroundWorkers(deps: WorkerStartupDeps, intervalMs: number = 60_000): void {
  deps.summaryWorker.start(intervalMs);
  deps.embeddingWorker.start(intervalMs);
}
