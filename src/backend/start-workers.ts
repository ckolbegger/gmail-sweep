/**
 * Background workers that process the email pipeline on a periodic timer.
 * Started once at boot (see index.ts) so the backlog of summarized-but-unembedded
 * emails gets processed even when no new mail is being synced.
 *
 * Without this, EmbeddingWorker only ran inside sync triggers gated on
 * `result.fetched > 0` — which never fire once the mailbox is already synced,
 * leaving vec_embeddings permanently empty.
 */

export interface BackgroundWorker {
  start(intervalMs?: number): void;
}

export interface BackgroundWorkers {
  summaryWorker?: BackgroundWorker;
  embeddingWorker?: BackgroundWorker;
}

export function startBackgroundWorkers(
  workers: BackgroundWorkers,
  intervalMs: number = 60000
): void {
  workers.summaryWorker?.start(intervalMs);
  workers.embeddingWorker?.start(intervalMs);
}
