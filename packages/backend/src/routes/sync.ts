import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { EmbedService } from '../services/embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import type { SummarizerWorker } from '../services/summarizer.js';
import { runSyncWithEmbeddings } from '../services/sync.js';

export async function syncRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; embed: EmbedService; config: AppConfig; defaultBatchSize: number; summarizer: SummarizerWorker }
) {
  const { db, gmail, embed, config, defaultBatchSize, summarizer } = options;

  app.post('/sync', async (request) => {
    const body = request.body as { batchSize?: number; skipEmbeddings?: boolean } | undefined;
    const batchSize = body?.batchSize ?? defaultBatchSize;
    const skipEmbeddings = body?.skipEmbeddings ?? false;
    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize, skipEmbeddings });
    summarizer.trigger();
    return result;
  });

  app.get('/sync/status', async () => {
    const state = db.getSyncState();
    const gaps = db.listGaps();
    return {
      totalSynced: state.totalSynced,
      newestDate: state.newestDate,
      oldestDate: state.oldestDate,
      gaps,
      hasGaps: gaps.length > 0,
    };
  });

  app.get('/sync/gaps', async () => {
    const gaps = db.listGaps();
    const totalMissing = gaps.reduce((sum, g) => sum + g.estimatedCount, 0);
    return { gaps, totalMissing };
  });
}
