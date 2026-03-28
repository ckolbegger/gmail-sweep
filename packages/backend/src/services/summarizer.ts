import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import { getOrCreateSummary } from './email-ops.js';
import type { SummarizerStatus } from '@gmail-sweep/shared';

export interface SummarizerWorker {
  trigger(): void;
  getStatus(): SummarizerStatus;
}

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 64_000;

function isRateLimitError(err: unknown): boolean {
  return (err as { status?: number })?.status === 429;
}

export function createSummarizerWorker(db: DbHandle, ai: AiService): SummarizerWorker {
  let currentStatus: 'running' | 'idle' = 'idle';
  let processed = 0;
  let pending = db.countEmailsWithoutSummary();
  let backoffMs = INITIAL_BACKOFF_MS;

  async function run(): Promise<void> {
    currentStatus = 'running';
    processed = 0;
    pending = db.countEmailsWithoutSummary();
    const failedIds = new Set<string>();
    while (true) {
      const email = db.getNextEmailWithoutSummary();
      if (!email) break;
      if (failedIds.has(email.id)) break; // remaining emails already failed this run
      try {
        await getOrCreateSummary(db, ai, email.id);
        processed++;
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (err) {
        if (isRateLimitError(err)) {
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        } else {
          console.error(`[summarizer] failed to summarize email ${email.id}:`, err);
          failedIds.add(email.id);
        }
      }
    }
    currentStatus = 'idle';
  }

  return {
    trigger() {
      if (currentStatus === 'idle') { run(); }
    },
    getStatus(): SummarizerStatus {
      return { status: currentStatus, processed, pending };
    },
  };
}
