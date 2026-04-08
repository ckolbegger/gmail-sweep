export const SCHEMA = `
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  sender TEXT,
  recipients TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  date_sent INTEGER,
  date_received INTEGER,
  labels TEXT,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  fetched_at INTEGER,
  ai_status TEXT DEFAULT 'pending',
  summary TEXT,
  action_items TEXT,
  key_points TEXT,
  summary_model TEXT,
  summary_generated_at INTEGER,
  embedding BLOB,
  embedding_model TEXT,
  embedding_generated_at INTEGER,
  removed_state TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_date_received ON emails(date_received);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_ai_status ON emails(ai_status);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_token TEXT NOT NULL,
  estimated_count INTEGER,
  status TEXT DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
