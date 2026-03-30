import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";
import { GapManager } from "./gap-manager";

export interface SyncResult {
  fetched: number;
  skipped: number;
  gapFilled?: number;
}

export interface SyncStatus {
  totalEmails: number;
  unreadCount: number;
  lastHistoryId: string | null;
}

export class SyncService {
  private db: Database;
  private adapter: GmailAdapter;
  private gapManager: GapManager;

  constructor(db: Database, adapter: GmailAdapter) {
    this.db = db;
    this.adapter = adapter;
    this.gapManager = new GapManager(db);
  }

  async syncNewest(batchSize: number): Promise<SyncResult> {
    // Prevent concurrent syncs
    this.assertNotSyncing();
    this.setSyncInProgress(true);

    try {
      const listResult = await this.adapter.listMessages({
        maxResults: batchSize,
        labelIds: ["INBOX"],
      });


      let fetched = 0;
      let skipped = 0;

      for (const msg of listResult.messages) {
        const existing = this.db
          .query("SELECT id FROM emails WHERE id = ?")
          .get(msg.id);
        if (existing) {
          skipped++;
          continue;
        }

        const fullMsg = await this.adapter.getMessage(msg.id);
        if (!fullMsg) continue;

        // Capture historyId from individual message responses
        if ((this.adapter as any)._lastHistoryId) {
          this.db.run(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_history_id', ?)",
            [(this.adapter as any)._lastHistoryId]
          );
        }

        this.db.run(
          `INSERT OR IGNORE INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fullMsg.id,
            fullMsg.threadId,
            fullMsg.sender,
            JSON.stringify(fullMsg.recipients),
            fullMsg.subject,
            fullMsg.bodyText,
            fullMsg.bodyHtml,
            fullMsg.dateSent,
            fullMsg.dateReceived,
            JSON.stringify(fullMsg.labels),
            fullMsg.isRead ? 1 : 0,
            fullMsg.isStarred ? 1 : 0,
            Date.now(),
          ]
        );
        fetched++;
      }

      // Store historyId for incremental sync
      if (listResult.historyId) {
        this.db.run(
          "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_history_id', ?)",
          [listResult.historyId]
        );
      }

      // Create gap if there are more pages
      let gapFilled = 0;
      if (listResult.nextPageToken) {
        this.gapManager.createGap(listResult.nextPageToken);

        // Use remaining batch capacity for gap fill
        const remaining = batchSize - fetched - skipped;
        if (remaining > 0) {
          const nextGap = this.gapManager.getNextGapToFill();
          if (nextGap) {
            const fillResult = await this.gapManager.fillGap(
              nextGap.id,
              this.adapter
            );
            gapFilled = fillResult.fetched;
            fetched += fillResult.fetched;
          }
        }
      }

      return { fetched, skipped, gapFilled };
    } finally {
      this.setSyncInProgress(false);
    }
  }

  async syncIncremental(): Promise<SyncResult & { deleted?: number }> {
    const historyRow = this.db
      .query("SELECT value FROM sync_state WHERE key = 'last_history_id'")
      .get() as any;

    if (!historyRow) {
      return { fetched: 0, skipped: 0 };
    }

    const historyResult = await this.adapter.listHistory({
      startHistoryId: historyRow.value,
    });

    let fetched = 0;
    let skipped = 0;
    let deleted = 0;

    for (const record of historyResult.history) {
      // Handle messages added
      if (record.messagesAdded) {
        for (const msg of record.messagesAdded) {
          const existing = this.db
            .query("SELECT id FROM emails WHERE id = ?")
            .get(msg.id);
          if (existing) {
            skipped++;
            continue;
          }

          const fullMsg = await this.adapter.getMessage(msg.id);
          if (!fullMsg) continue;

          this.db.run(
            `INSERT OR IGNORE INTO emails (id, thread_id, sender, recipients, subject, body_text, body_html, date_sent, date_received, labels, is_read, is_starred, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fullMsg.id,
              fullMsg.threadId,
              fullMsg.sender,
              JSON.stringify(fullMsg.recipients),
              fullMsg.subject,
              fullMsg.bodyText,
              fullMsg.bodyHtml,
              fullMsg.dateSent,
              fullMsg.dateReceived,
              JSON.stringify(fullMsg.labels),
              fullMsg.isRead ? 1 : 0,
              fullMsg.isStarred ? 1 : 0,
              Date.now(),
            ]
          );
          fetched++;
        }
      }

      // Handle messages deleted
      if (record.messagesDeleted) {
        for (const msg of record.messagesDeleted) {
          this.db.run("DELETE FROM emails WHERE id = ?", [msg.id]);
          deleted++;
        }
      }
    }

    // Update last_history_id
    if (historyResult.historyId) {
      this.db.run(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_history_id', ?)",
        [historyResult.historyId]
      );
    }

    return { fetched, skipped, deleted };
  }

  getSyncStatus(): SyncStatus {
    const totalRow = this.db
      .query("SELECT COUNT(*) as c FROM emails")
      .get() as any;
    const unreadRow = this.db
      .query("SELECT COUNT(*) as c FROM emails WHERE is_read = 0")
      .get() as any;
    const historyRow = this.db
      .query("SELECT value FROM sync_state WHERE key = 'last_history_id'")
      .get() as any;

    return {
      totalEmails: totalRow?.c ?? 0,
      unreadCount: unreadRow?.c ?? 0,
      lastHistoryId: historyRow?.value ?? null,
    };
  }

  private assertNotSyncing(): void {
    const row = this.db
      .query("SELECT value FROM sync_state WHERE key = 'sync_in_progress'")
      .get() as any;
    if (row && row.value === "1") {
      const err = new Error("Sync already in progress");
      (err as any).status = 409;
      throw err;
    }
  }

  private setSyncInProgress(inProgress: boolean): void {
    if (inProgress) {
      this.db.run(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('sync_in_progress', '1')"
      );
    } else {
      this.db.run(
        "DELETE FROM sync_state WHERE key = 'sync_in_progress'"
      );
    }
  }
}
