import type { DbHandle } from './db.js';
import type { GmailService } from './gmail.js';
import type { SyncResult, AppConfig } from '@gmail-sweep/shared';
import type { EmbedService } from './embed.js';
import { generatePendingEmbeddings } from './embeddings.js';

interface SyncOptions {
  batchSize: number;
}

export async function runSyncCycle(
  db: DbHandle,
  gmail: GmailService,
  options: SyncOptions
): Promise<SyncResult> {
  let remaining = options.batchSize;
  let newEmails = 0;
  let gapsFilled = 0;
  let olderFetched = 0;

  const state = db.getSyncState();

  // Step 1: Fetch newest emails
  const { emails: fetched, historyId: newHistoryId } = await gmail.fetchMessagesSince(state.newestDate, remaining);

  for (const email of fetched) {
    const existing = db.getEmail(email.id);
    if (!existing) {
      db.upsertEmail(email);
      newEmails++;
    }
  }

  remaining -= fetched.length;

  // Update newest date if we got anything
  if (fetched.length > 0) {
    const sortedByDate = [...fetched].sort((a, b) => b.date.localeCompare(a.date));
    const fetchedNewest = sortedByDate[0]!.date;
    const fetchedOldest = sortedByDate[sortedByDate.length - 1]!.date;

    // If batch was fully consumed and there was a date jump, record a gap
    if (remaining === 0 && state.newestDate && fetchedOldest > state.newestDate) {
      db.createGap({
        newerBoundary: fetchedOldest,
        olderBoundary: state.newestDate,
        estimatedCount: 0, // unknown
      });
    }

    db.updateSyncState({
      newestDate: state.newestDate
        ? (fetchedNewest > state.newestDate ? fetchedNewest : state.newestDate)
        : fetchedNewest,
      oldestDate: state.oldestDate ?? fetchedOldest,
      totalSynced: state.totalSynced + newEmails,
    });
  }

  // Persist historyId from full sync for future incremental syncs
  if (newHistoryId) db.setLastHistoryId(newHistoryId);

  // Step 2: Fill gaps (oldest gap first — lowest newerBoundary)
  if (remaining > 0) {
    const gaps = db.listGaps().sort((a, b) => a.newerBoundary.localeCompare(b.newerBoundary));

    for (const gap of gaps) {
      if (remaining <= 0) break;

      const gapEmails = await gmail.fetchMessagesInRange(
        gap.newerBoundary,
        gap.olderBoundary,
        remaining
      );

      for (const email of gapEmails) {
        if (!db.getEmail(email.id)) {
          db.upsertEmail(email);
          gapsFilled++;
        }
      }
      remaining -= gapEmails.length;

      if (gapEmails.length === 0) {
        // Gap fully filled (or empty) — remove it
        db.deleteGap(gap.id);
      } else if (gapEmails.length < remaining + gapEmails.length) {
        // Partially filled — shrink the gap boundary
        const oldest = [...gapEmails].sort((a, b) => a.date.localeCompare(b.date))[0];
        if (oldest) {
          db.updateGapBoundary(gap.id, {
            olderBoundary: oldest.date,
            estimatedCount: Math.max(0, gap.estimatedCount - gapEmails.length),
          });
        }
        db.deleteGap(gap.id); // simple: remove when we've processed it once fully within budget
      } else {
        db.deleteGap(gap.id);
      }
    }
  }

  // Step 3: Fetch older emails
  const refreshedState = db.getSyncState();
  if (remaining > 0 && db.listGaps().length === 0 && refreshedState.oldestDate) {
    const older = (await gmail.fetchMessagesBefore(refreshedState.oldestDate, remaining)) ?? [];

    for (const email of older) {
      if (!db.getEmail(email.id)) {
        db.upsertEmail(email);
        olderFetched++;
      }
    }

    if (older.length > 0) {
      const sortedOlder = [...older].sort((a, b) => a.date.localeCompare(b.date));
      db.updateSyncState({
        newestDate: refreshedState.newestDate ?? sortedOlder[sortedOlder.length - 1]!.date,
        oldestDate: sortedOlder[0]!.date,
        totalSynced: refreshedState.totalSynced + olderFetched,
      });
    }
  }

  return {
    fetched: fetched.length + gapsFilled + olderFetched,
    newEmails,
    gapsFilled,
    olderFetched,
    remainingGaps: db.listGaps(),
  };
}

const EMBEDDING_BATCH_SIZE = 50;

export async function runSyncWithEmbeddings(
  db: DbHandle,
  gmail: GmailService,
  embed: EmbedService,
  config: AppConfig,
  options: SyncOptions & { skipEmbeddings?: boolean }
): Promise<SyncResult & { embeddingsGenerated: number }> {
  const syncResult = await runSyncCycle(db, gmail, options);

  let embeddingsGenerated = 0;
  if (!options.skipEmbeddings) {
    const { activeStrategy, strategies } = config.contentExtraction;
    const strategy = strategies[activeStrategy];
    if (strategy) {
      embeddingsGenerated = await generatePendingEmbeddings(
        db, embed, strategy, EMBEDDING_BATCH_SIZE
      );
    }
  }

  return { ...syncResult, embeddingsGenerated };
}
