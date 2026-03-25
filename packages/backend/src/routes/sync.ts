import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { EmbedService } from '../services/embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import { runSyncCycle } from '../services/sync.js';
import { generatePendingEmbeddings } from '../services/embeddings.js';

const EMBEDDING_BATCH_SIZE = 50;

export async function syncRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; embed: EmbedService; config: AppConfig; defaultBatchSize: number }
) {
  const { db, gmail, embed, config, defaultBatchSize } = options;

  app.post('/sync', async (request) => {
    const body = request.body as { batchSize?: number } | undefined;
    const batchSize = body?.batchSize ?? defaultBatchSize;

    const syncResult = await runSyncCycle(db, gmail, { batchSize });

    const { activeStrategy, strategies } = config.contentExtraction;
    const strategy = strategies[activeStrategy];
    let embeddingsGenerated = 0;
    if (strategy) {
      embeddingsGenerated = await generatePendingEmbeddings(db, embed, activeStrategy, strategy, EMBEDDING_BATCH_SIZE);
    }

    return { ...syncResult, embeddingsGenerated };
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
