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
  fetched_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_emails_date_received ON emails(date_received);
CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;
