import type { DbHandle } from './db.js';
import type { GmailService } from './gmail.js';
import type { SyncResult, AppConfig, Gap } from '@gmail-sweep/shared';
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
      const { fetched: gapFetched } = await fillSingleGap(db, gmail, gap, remaining);
      gapsFilled += gapFetched;
      remaining -= gapFetched;
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

export async function runIncrementalSync(
  db: DbHandle,
  gmail: GmailService
): Promise<SyncResult & { deleted: number; mode: 'incremental' | 'full' }> {
  const { lastHistoryId } = db.getSyncState();
  if (!lastHistoryId) {
    return { fetched: 0, newEmails: 0, gapsFilled: 0, olderFetched: 0, deleted: 0, remainingGaps: db.listGaps(), mode: 'full' };
  }

  const hist = await gmail.listHistory(lastHistoryId);
  if (hist.expired) {
    db.setLastHistoryId(null);
    return { fetched: 0, newEmails: 0, gapsFilled: 0, olderFetched: 0, deleted: 0, remainingGaps: db.listGaps(), mode: 'full' };
  }

  let newEmails = 0;
  let deleted = 0;

  for (const record of hist.history) {
    for (const m of record.messagesAdded ?? []) {
      if (db.getEmail(m.id)) continue;
      const full = await gmail.fetchMessagesById(m.id);
      if (full) { db.upsertEmail(full); newEmails++; }
    }
    for (const m of record.messagesDeleted ?? []) {
      db.markEmailRemoved(m.id, 'deleted');
      deleted++;
    }
  }

  db.setLastHistoryId(hist.historyId);
  const state = db.getSyncState();
  db.updateSyncState({
    newestDate: state.newestDate ?? '',
    oldestDate: state.oldestDate ?? '',
    totalSynced: state.totalSynced + newEmails,
  });

  return {
    fetched: newEmails,
    newEmails,
    gapsFilled: 0,
    olderFetched: 0,
    deleted,
    remainingGaps: db.listGaps(),
    mode: 'incremental',
  };
}

export async function fillSingleGap(
  db: DbHandle,
  gmail: GmailService,
  gap: Gap,
  batchSize: number
): Promise<{ fetched: number; remaining: Gap | null }> {
  const emails = await gmail.fetchMessagesInRange(gap.newerBoundary, gap.olderBoundary, batchSize);
  let fetched = 0;
  for (const e of emails) {
    if (!db.getEmail(e.id)) { db.upsertEmail(e); fetched++; }
  }
  if (emails.length < batchSize) {
    db.deleteGap(gap.id);
    return { fetched, remaining: null };
  }
  const oldest = [...emails].sort((a, b) => a.date.localeCompare(b.date))[0]!;
  db.updateGapBoundary(gap.id, { olderBoundary: oldest.date, estimatedCount: Math.max(0, gap.estimatedCount - fetched) });
  const updated = db.getGap(gap.id);
  return { fetched, remaining: updated };
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
