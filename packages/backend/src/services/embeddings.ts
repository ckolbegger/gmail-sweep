import type { DbHandle } from './db.js';
import type { EmbedService } from './embed.js';
import { buildEmbeddingText } from './content.js';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

/**
 * Generates embeddings for up to `batchLimit` emails that don't yet have one
 * for the given strategy. Called after each sync cycle.
 *
 * Returns the number of embeddings generated.
 */
export async function generatePendingEmbeddings(
  db: DbHandle,
  embedService: EmbedService,
  strategyId: string,
  strategy: ExtractionStrategy,
  batchLimit: number
): Promise<number> {
  const pending = db.getEmailsWithoutEmbedding(strategyId, batchLimit);
  let count = 0;

  for (const email of pending) {
    const text = buildEmbeddingText({ subject: email.subject, bodyText: email.bodyText }, strategy);
    const vector = await embedService.embedDocument(text);
    db.upsertEmbedding(email.id, strategyId, vector);
    db.markEmbedded(email.id, strategyId);
    count++;
  }

  return count;
}
