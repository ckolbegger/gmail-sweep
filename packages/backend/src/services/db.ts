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
  markEmbedded(id: string, strategy: string): void;
  upsertEmbedding(emailId: string, strategy: string, vector: number[]): void;
  getEmbeddingsForStrategy(strategy: string, limit: number): Array<{ emailId: string; vector: number[] }>;
  getSyncState(): Pick<SyncStatus, 'totalSynced' | 'newestDate' | 'oldestDate'>;
  updateSyncState(state: { newestDate: string; oldestDate: string; totalSynced: number }): void;
  listGaps(): Gap[];
  createGap(gap: { newerBoundary: string; olderBoundary: string; estimatedCount: number }): Gap;
  deleteGap(id: number): void;
  updateGapBoundary(id: number, update: { olderBoundary: string; estimatedCount: number }): void;
  getEmailsWithoutEmbedding(strategy: string, limit: number): Email[];
  close(): void;
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
      has_embedding     INTEGER NOT NULL DEFAULT 0,
      embedding_strategy TEXT,
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

    -- email_embeddings: stores one vector per (email_id, strategy) pair.
    -- sqlite-vec vec0 does not support composite primary keys, so we use a
    -- conventional table with a unique index and store the vector as a BLOB.
    -- vec_distance_cosine() works on BLOB float arrays without a vec0 virtual table.
    CREATE TABLE IF NOT EXISTS email_embeddings (
      email_id  TEXT NOT NULL,
      strategy  TEXT NOT NULL,
      vector    BLOB NOT NULL,
      PRIMARY KEY (email_id, strategy)
    );
  `);
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
    hasEmbedding: Boolean(row.has_embedding),
    embeddingStrategy: (row.embedding_strategy as string) ?? null,
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
        INSERT INTO emails (id, thread_id, subject, sender, date, snippet, body_text, body_html, labels, summary, has_embedding, embedding_strategy)
        VALUES (@id, @threadId, @subject, @sender, @date, @snippet, @bodyText, @bodyHtml, @labels, @summary, @hasEmbedding, @embeddingStrategy)
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
        hasEmbedding: email.hasEmbedding ? 1 : 0,
        embeddingStrategy: email.embeddingStrategy ?? null,
      });
    },

    getEmail(id) {
      const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? rowToEmail(row) : null;
    },

    listEmails(params) {
      const conditions: string[] = [];
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

    markEmbedded(id, strategy) {
      db.prepare('UPDATE emails SET has_embedding = 1, embedding_strategy = ? WHERE id = ?')
        .run(strategy, id);
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

    getEmailsWithoutEmbedding(strategy, limit) {
      const rows = db.prepare(`
        SELECT * FROM emails WHERE has_embedding = 0 OR embedding_strategy != ?
        ORDER BY date DESC LIMIT ?
      `).all(strategy, limit) as Record<string, unknown>[];
      return rows.map(rowToEmail);
    },

    upsertEmbedding(emailId, strategy, vector) {
      // Store float array as raw BLOB (4 bytes per float, little-endian)
      const buf = Buffer.allocUnsafe(vector.length * 4);
      for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i]!, i * 4);
      db.prepare(`
        INSERT INTO email_embeddings (email_id, strategy, vector)
        VALUES (?, ?, ?)
        ON CONFLICT(email_id, strategy) DO UPDATE SET vector = excluded.vector
      `).run(emailId, strategy, buf);
    },

    getEmbeddingsForStrategy(strategy, limit) {
      const rows = db.prepare(
        'SELECT email_id, vector FROM email_embeddings WHERE strategy = ? LIMIT ?'
      ).all(strategy, limit) as Array<{ email_id: string; vector: Buffer }>;
      return rows.map(r => {
        const vector: number[] = [];
        for (let i = 0; i < r.vector.length; i += 4) vector.push(r.vector.readFloatLE(i));
        return { emailId: r.email_id, vector };
      });
    },

    close() {
      db.close();
    },
  };
}
