import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

export interface SyncResult {
  fetched: number;
  skipped: number;
}

export interface SyncStatus {
  totalEmails: number;
  unreadCount: number;
  lastHistoryId: string | null;
}

export class SyncService {
  private db: Database;
  private adapter: GmailAdapter;

  constructor(db: Database, adapter: GmailAdapter) {
    this.db = db;
    this.adapter = adapter;
  }

  async syncNewest(batchSize: number): Promise<SyncResult> {
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

    return { fetched, skipped };
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
}
