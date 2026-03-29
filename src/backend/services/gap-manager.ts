import type Database from "bun:sqlite";
import type { GmailAdapter } from "@backend/gmail/adapter";

export interface Gap {
  id: number;
  page_token: string;
  estimated_count: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface FillResult {
  fetched: number;
  skipped: number;
}

export class GapManager {
  constructor(private db: Database) {}

  createGap(pageToken: string, estimatedCount?: number): number {
    const now = Date.now();
    const result = this.db.run(
      `INSERT INTO gaps (page_token, estimated_count, status, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?)`,
      [pageToken, estimatedCount ?? null, now, now]
    );
    return Number(result.lastInsertRowid);
  }

  getNextGapToFill(): Gap | null {
    return (
      (this.db
        .query(
          "SELECT * FROM gaps WHERE status = 'open' ORDER BY created_at ASC LIMIT 1"
        )
        .get() as Gap | null) ?? null
    );
  }

  async fillGap(gapId: number, adapter: GmailAdapter): Promise<FillResult> {
    // Atomically set status to 'filling' - skip if already filling
    const updated = this.db.run(
      "UPDATE gaps SET status = 'filling', updated_at = ? WHERE id = ? AND status = 'open'",
      [Date.now(), gapId]
    );
    if (updated.changes === 0) {
      return { fetched: 0, skipped: 0 };
    }

    const gap = this.db
      .query("SELECT * FROM gaps WHERE id = ?")
      .get(gapId) as Gap;

    try {
      const listResult = await adapter.listMessages({
        maxResults: 100,
        pageToken: gap.page_token,
        labelIds: ["INBOX"],
      });

      let fetched = 0;
      let skipped = 0;

      for (const msg of listResult.messages) {
        const fullMsg = await adapter.getMessage(msg.id);
        if (!fullMsg) continue;

        const insertResult = this.db.run(
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
        if (insertResult.changes > 0) {
          fetched++;
        } else {
          skipped++;
        }
      }

      const now = Date.now();
      if (listResult.nextPageToken) {
        // Update page_token, keep open
        this.db.run(
          "UPDATE gaps SET page_token = ?, status = 'open', updated_at = ? WHERE id = ?",
          [listResult.nextPageToken, now, gapId]
        );
      } else {
        // Close gap
        this.db.run(
          "UPDATE gaps SET status = 'closed', updated_at = ? WHERE id = ?",
          [now, gapId]
        );
      }

      return { fetched, skipped };
    } catch (err) {
      // Return gap to 'open' on failure
      this.db.run(
        "UPDATE gaps SET status = 'open', updated_at = ? WHERE id = ?",
        [Date.now(), gapId]
      );
      throw err;
    }
  }

  abandonGap(gapId: number): void {
    this.db.run(
      "UPDATE gaps SET status = 'closed', updated_at = ? WHERE id = ?",
      [Date.now(), gapId]
    );
  }

  getOpenGaps(): Gap[] {
    return this.db
      .query(
        "SELECT * FROM gaps WHERE status = 'open' ORDER BY created_at ASC"
      )
      .all() as Gap[];
  }
}
