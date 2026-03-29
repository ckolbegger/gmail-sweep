import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Email, EmailSummary, Gap, SyncStatus, EmailListParams } from '@gmail-sweep/shared';

export interface DbHandle {
  upsertEmail(email: Email): void;
  getEmail(id: string): Email | null;
  listEmails(params: EmailListParams): Email[];
  updateSummary(id: string, summary: EmailSummary): void;
  archiveEmail(id: string): void;
  trashEmail(id: string): void;
  upsertEmbedding(emailId: string, vector: number[]): void;
  searchEmbeddings(queryVector: number[], k: number): Array<{ emailId: string; distance: number }>;
  getSyncState(): Pick<SyncStatus, 'totalSynced' | 'newestDate' | 'oldestDate'>;
  updateSyncState(state: { newestDate: string; oldestDate: string; totalSynced: number }): void;
  listGaps(): Gap[];
  createGap(gap: { newerBoundary: string; olderBoundary: string; estimatedCount: number }): Gap;
  deleteGap(id: number): void;
  updateGapBoundary(id: number, update: { olderBoundary: string; estimatedCount: number }): void;
  getEmailsWithoutEmbedding(limit: number): Email[];
  getNextEmailWithoutSummary(): Email | null;
  countEmailsWithoutSummary(): number;
  close(): void;
}

function vectorToBuffer(vector: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i]!, i * 4);
  return buf;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id                TEXT PRIMARY KEY,
      thread_id         TEXT NOT NULL,
      subject           TEXT,
      sender            TEXT NOT NULL,
      date              TEXT NOT NULL,
      snippet           TEXT,
      body_text         TEXT,
      body_html         TEXT,
      labels            TEXT NOT NULL DEFAULT '[]',
      summary           TEXT,
      synced_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_emails_date   ON emails(date DESC);
    CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender);
    CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);

    CREATE TABLE IF NOT EXISTS sync_state (
      id            INTEGER PRIMARY KEY DEFAULT 1,
      newest_date   TEXT,
      oldest_date   TEXT,
      total_synced  INTEGER NOT NULL DEFAULT 0,
      last_sync_at  TEXT
    );

    INSERT OR IGNORE INTO sync_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS sync_gaps (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      newer_boundary   TEXT NOT NULL,
      older_boundary   TEXT NOT NULL,
      estimated_count  INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_gaps_boundaries
      ON sync_gaps(newer_boundary, older_boundary);
  `);

  // Create vec0 virtual table (requires sqlite-vec to be loaded)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings
      USING vec0(embedding float[1024], +email_id TEXT)
  `);

  // Migration: copy from legacy email_embeddings table if it exists
  const legacyExists = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='email_embeddings'`
  ).get() as { name: string } | undefined) !== undefined;

  if (legacyExists) {
    const legacyRows = db.prepare('SELECT email_id, vector FROM email_embeddings').all() as Array<{
      email_id: string;
      vector: Buffer;
    }>;
    const insert = db.prepare('INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)');
    const migrate = db.transaction(() => {
      for (const row of legacyRows) {
        try {
          insert.run(row.email_id, row.vector);
        } catch {
          // skip duplicates or invalid rows
        }
      }
    });
    migrate();
    db.exec('DROP TABLE email_embeddings');
  }

  // Migration: drop legacy embedding columns from emails if they exist
  const emailsCols = (db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>)
    .map(c => c.name);
  if (emailsCols.includes('has_embedding')) {
    db.exec('ALTER TABLE emails DROP COLUMN has_embedding');
  }
  if (emailsCols.includes('embedding_strategy')) {
    db.exec('ALTER TABLE emails DROP COLUMN embedding_strategy');
  }
}

function rowToEmail(row: Record<string, unknown>): Email {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    subject: (row.subject as string) ?? '',
    from: row.sender as string,
    date: row.date as string,
    snippet: (row.snippet as string) ?? '',
    bodyText: (row.body_text as string) ?? '',
    bodyHtml: (row.body_html as string) ?? null,
    labels: JSON.parse((row.labels as string) ?? '[]') as string[],
    summary: row.summary ? (JSON.parse(row.summary as string) as EmailSummary) : null,
  };
}

export function createDb(dbPath: string): DbHandle {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  try {
    sqliteVec.load(db);
  } catch {
    // sqlite-vec not available — vector search will not work
  }

  applySchema(db);

  return {
    upsertEmail(email) {
      db.prepare(`
        INSERT INTO emails (id, thread_id, subject, sender, date, snippet, body_text, body_html, labels, summary)
        VALUES (@id, @threadId, @subject, @sender, @date, @snippet, @bodyText, @bodyHtml, @labels, @summary)
        ON CONFLICT(id) DO UPDATE SET
          subject = excluded.subject, sender = excluded.sender, date = excluded.date,
          snippet = excluded.snippet, labels = excluded.labels,
          body_text = COALESCE(excluded.body_text, body_text),
          body_html = COALESCE(excluded.body_html, body_html),
          synced_at = datetime('now')
      `).run({
        id: email.id,
        threadId: email.threadId,
        subject: email.subject ?? null,
        sender: email.from,
        date: email.date,
        snippet: email.snippet ?? null,
        bodyText: email.bodyText ?? null,
        bodyHtml: email.bodyHtml ?? null,
        labels: JSON.stringify(email.labels),
        summary: email.summary ? JSON.stringify(email.summary) : null,
      });
    },

    getEmail(id) {
      const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? rowToEmail(row) : null;
    },

    listEmails(params) {
      const conditions: string[] = ["labels LIKE '%INBOX%'"];
      const bindings: unknown[] = [];

      if (params.sender) {
        conditions.push("sender LIKE ?");
        bindings.push(`%${params.sender}%`);
      }
      if (params.date_from) {
        conditions.push("date >= ?");
        bindings.push(params.date_from);
      }
      if (params.date_to) {
        conditions.push("date <= ?");
        bindings.push(params.date_to);
      }
      if (params.subject) {
        conditions.push("subject LIKE ?");
        bindings.push(`%${params.subject}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = params.limit ?? 50;
      const offset = params.offset ?? 0;

      const rows = db.prepare(
        `SELECT * FROM emails ${where} ORDER BY date DESC LIMIT ? OFFSET ?`
      ).all([...bindings, limit, offset]) as Record<string, unknown>[];

      return rows.map(rowToEmail);
    },

    updateSummary(id, summary) {
      db.prepare('UPDATE emails SET summary = ? WHERE id = ?')
        .run(JSON.stringify(summary), id);
    },

    archiveEmail(id) {
      const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
      if (!row) return;
      const labels = (JSON.parse(row.labels) as string[]).filter(l => l !== 'INBOX');
      db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(labels), id);
    },

    trashEmail(id) {
      const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
      if (!row) return;
      const labels = JSON.parse(row.labels) as string[];
      if (!labels.includes('TRASH')) labels.push('TRASH');
      db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(labels), id);
    },

    getSyncState() {
      const row = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as Record<string, unknown>;
      return {
        totalSynced: (row?.total_synced as number) ?? 0,
        newestDate: (row?.newest_date as string) ?? null,
        oldestDate: (row?.oldest_date as string) ?? null,
      };
    },

    updateSyncState({ newestDate, oldestDate, totalSynced }) {
      db.prepare(`
        UPDATE sync_state SET newest_date = ?, oldest_date = ?, total_synced = ?, last_sync_at = datetime('now')
        WHERE id = 1
      `).run(newestDate, oldestDate, totalSynced);
    },

    listGaps() {
      const rows = db.prepare('SELECT * FROM sync_gaps ORDER BY newer_boundary DESC').all() as Record<string, unknown>[];
      return rows.map(r => ({
        id: r.id as number,
        newerBoundary: r.newer_boundary as string,
        olderBoundary: r.older_boundary as string,
        estimatedCount: r.estimated_count as number,
      }));
    },

    createGap({ newerBoundary, olderBoundary, estimatedCount }) {
      const result = db.prepare(`
        INSERT INTO sync_gaps (newer_boundary, older_boundary, estimated_count)
        VALUES (?, ?, ?)
      `).run(newerBoundary, olderBoundary, estimatedCount);

      return { id: result.lastInsertRowid as number, newerBoundary, olderBoundary, estimatedCount };
    },

    deleteGap(id) {
      db.prepare('DELETE FROM sync_gaps WHERE id = ?').run(id);
    },

    updateGapBoundary(id, { olderBoundary, estimatedCount }) {
      db.prepare(`
        UPDATE sync_gaps SET older_boundary = ?, estimated_count = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(olderBoundary, estimatedCount, id);
    },

    upsertEmbedding(emailId, vector) {
      const buf = vectorToBuffer(vector);
      // vec0 doesn't support ON CONFLICT UPDATE, so delete-then-insert
      const existing = db.prepare(
        'SELECT rowid FROM vec_embeddings WHERE email_id = ?'
      ).get(emailId) as { rowid: number } | undefined;
      if (existing) {
        db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(existing.rowid);
      }
      db.prepare('INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)').run(emailId, buf);
    },

    searchEmbeddings(queryVector, k) {
      const buf = vectorToBuffer(queryVector);
      const rows = db.prepare(`
        SELECT email_id, distance FROM vec_embeddings
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `).all(buf, k) as Array<{ email_id: string; distance: number }>;
      return rows.map(r => ({ emailId: r.email_id, distance: r.distance }));
    },

    getEmailsWithoutEmbedding(limit) {
      const rows = db.prepare(`
        SELECT e.* FROM emails e
        LEFT JOIN vec_embeddings ve ON ve.email_id = e.id
        WHERE ve.email_id IS NULL
        ORDER BY e.date DESC LIMIT ?
      `).all(limit) as Record<string, unknown>[];
      return rows.map(rowToEmail);
    },

    getNextEmailWithoutSummary() {
      const row = db.prepare(
        'SELECT * FROM emails WHERE summary IS NULL ORDER BY date DESC LIMIT 1'
      ).get() as Record<string, unknown> | undefined;
      return row ? rowToEmail(row) : null;
    },

    countEmailsWithoutSummary() {
      const row = db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE summary IS NULL'
      ).get() as { count: number };
      return row.count;
    },

    close() {
      db.close();
    },
  };
}
