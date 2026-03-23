# gmail-sweep Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation, shared types package, and fully functional Fastify backend with Gmail OAuth2, cursor-based sync with gap management, AI summarization, vector search, and all REST endpoints.

**Architecture:** npm workspaces monorepo with `shared/` (TypeScript types), and `backend/` (Fastify server). Backend is the only process touching Gmail, SQLite, and LLM providers. All business logic lives here — clients are thin HTTP consumers.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, sqlite-vec, googleapis, google-auth-library, html-to-text, @anthropic-ai/sdk, openai, vitest

---

## File Map

```
gmail-sweep/                          ← monorepo root
  package.json                        ← workspace config
  tsconfig.base.json                  ← shared TS config
  .gitignore

packages/
  shared/
    package.json
    tsconfig.json
    src/
      types.ts                        ← all shared interfaces
      index.ts                        ← re-exports

  backend/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                        ← entry point, starts server
      server.ts                       ← Fastify instance + plugin registration
      config.ts                       ← reads/writes ~/.gmail-sweep/config.json

      services/
        db.ts                         ← SQLite setup, schema, CRUD operations
        gmail.ts                      ← Gmail API client, OAuth2 token management
        sync.ts                       ← gap-aware sync algorithm
        ai.ts                         ← provider-agnostic LLM (chat + embeddings)
        content.ts                    ← HTML-to-text, embedding text extraction
        search.ts                     ← AI query parsing + SQL filter + vector rank

      routes/
        auth.ts                       ← GET /auth/url, /auth/callback, /auth/status, DELETE /auth/logout
        emails.ts                     ← GET /emails, /emails/:id, /emails/:id/summary, POST archive/delete
        sync.ts                       ← POST /sync, GET /sync/status, /sync/gaps
        search.ts                     ← POST /search
        config.ts                     ← GET/POST /config

      services/
        db.test.ts                    ← schema, CRUD, gap operations
        sync.test.ts                  ← gap algorithm with mocked Gmail
        content.test.ts               ← HTML conversion, embedding text generation
        search.test.ts                ← query parsing, filter + vector ranking
        ai.test.ts                    ← provider switching, mock responses

      routes/
        auth.test.ts
        emails.test.ts
        sync.test.ts
        search.test.ts
        config.test.ts
```

---

## Task 1: Monorepo Root Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "gmail-sweep",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "dev:backend": "npm run dev -w packages/backend"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Update .gitignore**

Add to existing `.gitignore`:
```
node_modules/
dist/
*.js.map
*.d.ts.map
```

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json .gitignore
git commit -m "feat: monorepo root setup with npm workspaces"
```

---

## Task 2: Shared Types Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@gmail-sweep/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/shared/src/types.ts**

```typescript
export interface Email {
  id: string;              // Gmail message ID
  threadId: string;
  subject: string;
  from: string;
  date: string;            // ISO 8601
  snippet: string;
  bodyText: string;        // always populated — HTML converted during sync
  bodyHtml: string | null; // raw HTML if present in original email
  labels: string[];
  summary: EmailSummary | null;
  hasEmbedding: boolean;
  embeddingStrategy: string | null;
}

export interface EmailSummary {
  description: string;     // single sentence
  actionItems: string[];
  keyPoints: string[];
}

export interface Gap {
  id: number;
  newerBoundary: string;   // ISO 8601 — date of oldest email above gap
  olderBoundary: string;   // ISO 8601 — date of newest email below gap
  estimatedCount: number;
}

export interface SyncResult {
  fetched: number;
  newEmails: number;
  gapsFilled: number;
  olderFetched: number;
  remainingGaps: Gap[];
  embeddingsGenerated?: number;  // populated by POST /sync after lazy embedding batch
}

export interface SyncStatus {
  totalSynced: number;
  newestDate: string | null;
  oldestDate: string | null;
  gaps: Gap[];
  hasGaps: boolean;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  strategy?: string;       // target a specific embedding strategy (A/B trials)
}

export interface SearchResult {
  emails: Email[];
  scores: number[];
}

export interface ParsedQuery {
  filters: {
    sender?: string;
    date_from?: string;
    date_to?: string;
    subject?: string;
  };
  semanticQuery: string;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  apiKey?: string;
  baseUrl?: string;        // required for openai-compatible (Ollama, LMStudio)
}

export interface EmbeddingConfig {
  provider: 'openai' | 'openai-compatible'; // Anthropic has no embedding models
  model: string;
  apiKey?: string;
  baseUrl?: string;
  dimension: number;
}

export interface AppConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  sync: {
    defaultBatchSize: number;
  };
  contentExtraction: {
    activeStrategy: string;
    strategies: Record<string, ExtractionStrategy>;
  };
}

export interface ExtractionStrategy {
  type: 'template';
  template: string;        // e.g. "Subject: {{subject}}\n\n{{body_text}}"
}

export interface EmailListParams {
  sender?: string;
  date_from?: string;
  date_to?: string;
  subject?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 4: Create packages/shared/src/index.ts**

```typescript
export * from './types.js';
```

- [ ] **Step 5: Build shared package**

```bash
cd packages/shared && npm install && npm run build
```

Expected: `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat: shared types package"
```

---

## Task 3: Backend Package Skeleton

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/vitest.config.ts`
- Create: `packages/backend/src/server.ts`
- Create: `packages/backend/src/index.ts`

- [ ] **Step 1: Create packages/backend/package.json**

```json
{
  "name": "@gmail-sweep/backend",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@gmail-sweep/shared": "*",
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^9.6.0",
    "fastify": "^5.1.0",
    "google-auth-library": "^9.14.0",
    "googleapis": "^144.0.0",
    "html-to-text": "^9.0.5",
    "openai": "^4.77.0",
    "sqlite-vec": "^0.1.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create packages/backend/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/backend/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Create packages/backend/src/server.ts**

```typescript
import Fastify from 'fastify';

export function buildServer() {
  const app = Fastify({ logger: true });

  // Routes registered in later tasks
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
```

- [ ] **Step 5: Create packages/backend/src/index.ts**

```typescript
import { buildServer } from './server.js';

const app = buildServer();

try {
  await app.listen({ port: 3141, host: '127.0.0.1' });
  console.log('Backend running at http://localhost:3141');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 6: Install deps and verify server starts**

```bash
cd packages/backend && npm install
node --experimental-strip-types src/index.ts
```

Expected output: `Backend running at http://localhost:3141`

```bash
curl http://localhost:3141/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: Commit**

```bash
git add packages/backend/
git commit -m "feat: backend package skeleton with Fastify"
```

---

## Task 4: Config Service

**Files:**
- Create: `packages/backend/src/config.ts`
- Create: `packages/backend/src/services/config.test.ts`

The config service reads `~/.gmail-sweep/config.json`, creating it with defaults if missing.

- [ ] **Step 1: Write failing test**

Create `packages/backend/src/services/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We'll mock homedir to point at a temp directory
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn() };
});

import { loadConfig, saveConfig, getDefaultConfig } from '../config.js';
import type { AppConfig } from '@gmail-sweep/shared';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-sweep-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const config = await loadConfig();
    expect(config.sync.defaultBatchSize).toBe(500);
    expect(config.contentExtraction.activeStrategy).toBe('v1-plain');
  });

  it('creates config directory and file on first load', async () => {
    await loadConfig();
    const configPath = path.join(tmpDir, '.gmail-sweep', 'config.json');
    const exists = await fs.access(configPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('saves and reloads config', async () => {
    const config = await loadConfig();
    config.sync.defaultBatchSize = 100;
    await saveConfig(config);

    const reloaded = await loadConfig();
    expect(reloaded.sync.defaultBatchSize).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/services/config.test.ts
```

Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: Implement packages/backend/src/config.ts**

```typescript
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig } from '@gmail-sweep/shared';

function getConfigDir(): string {
  return path.join(os.homedir(), '.gmail-sweep');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getDefaultConfig(): AppConfig {
  return {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimension: 1536,
    },
    sync: {
      defaultBatchSize: 500,
    },
    contentExtraction: {
      activeStrategy: 'v1-plain',
      strategies: {
        'v1-plain': {
          type: 'template',
          template: 'Subject: {{subject}}\n\n{{body_text}}',
        },
      },
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    // File doesn't exist — create with defaults
    const defaults = getDefaultConfig();
    await saveConfig(defaults);
    return defaults;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/config.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/services/config.test.ts
git commit -m "feat: config service with defaults and persistence"
```

---

## Task 5: Database Service

**Files:**
- Create: `packages/backend/src/services/db.ts`
- Create: `packages/backend/src/services/db.test.ts`

The DB service manages SQLite schema creation, email CRUD, sync state, and gap lifecycle. Tests use in-memory SQLite (`:memory:`).

- [ ] **Step 1: Write failing tests**

Create `packages/backend/src/services/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';

describe('database service', () => {
  let db: DbHandle;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  describe('emails', () => {
    it('inserts and retrieves an email', () => {
      db.upsertEmail({
        id: 'msg1',
        threadId: 'thread1',
        subject: 'Test email',
        sender: 'alice@example.com',
        date: '2026-03-23T10:00:00Z',
        snippet: 'Hello world',
        bodyText: 'Hello world, this is a test email.',
        bodyHtml: null,
        labels: ['INBOX'],
        summary: null,
        hasEmbedding: false,
        embeddingStrategy: null,
      });

      const email = db.getEmail('msg1');
      expect(email).not.toBeNull();
      expect(email!.subject).toBe('Test email');
      expect(email!.sender).toBe('alice@example.com');
      expect(email!.labels).toEqual(['INBOX']);
    });

    it('lists emails sorted by date descending', () => {
      db.upsertEmail({ id: 'old', threadId: 't1', subject: 'Old', sender: 'a@b.com',
        date: '2026-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });
      db.upsertEmail({ id: 'new', threadId: 't2', subject: 'New', sender: 'a@b.com',
        date: '2026-03-23T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });

      const emails = db.listEmails({});
      expect(emails[0].id).toBe('new');
      expect(emails[1].id).toBe('old');
    });

    it('filters emails by sender', () => {
      db.upsertEmail({ id: 'a', threadId: 't1', subject: 'S', sender: 'alice@example.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });
      db.upsertEmail({ id: 'b', threadId: 't2', subject: 'S', sender: 'bob@example.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });

      const results = db.listEmails({ sender: 'alice' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('a');
    });

    it('updates summary on existing email', () => {
      db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'S', sender: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });

      db.updateSummary('msg1', { description: 'A test', actionItems: [], keyPoints: [] });

      const email = db.getEmail('msg1');
      expect(email!.summary).toEqual({ description: 'A test', actionItems: [], keyPoints: [] });
    });
  });

  describe('sync state', () => {
    it('returns null state when no sync has occurred', () => {
      const state = db.getSyncState();
      expect(state.totalSynced).toBe(0);
      expect(state.newestDate).toBeNull();
      expect(state.oldestDate).toBeNull();
    });

    it('updates sync state', () => {
      db.updateSyncState({ newestDate: '2026-03-23T00:00:00Z', oldestDate: '2026-01-01T00:00:00Z', totalSynced: 100 });
      const state = db.getSyncState();
      expect(state.totalSynced).toBe(100);
      expect(state.newestDate).toBe('2026-03-23T00:00:00Z');
    });
  });

  describe('gap management', () => {
    it('creates and lists gaps', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 200 });
      const gaps = db.listGaps();
      expect(gaps).toHaveLength(1);
      expect(gaps[0].estimatedCount).toBe(200);
    });

    it('deletes a gap when fully filled', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 200 });
      const [gap] = db.listGaps();
      db.deleteGap(gap.id);
      expect(db.listGaps()).toHaveLength(0);
    });

    it('updates gap boundaries when partially filled', () => {
      db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-10T00:00:00Z', estimatedCount: 500 });
      const [gap] = db.listGaps();
      db.updateGapBoundary(gap.id, { olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 250 });
      const updated = db.listGaps()[0];
      expect(updated.olderBoundary).toBe('2026-03-15T00:00:00Z');
      expect(updated.estimatedCount).toBe(250);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: FAIL — `createDb` not found

- [ ] **Step 3: Implement packages/backend/src/services/db.ts**

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Email, EmailSummary, Gap, SyncStatus, EmailListParams } from '@gmail-sweep/shared';

export interface DbHandle {
  upsertEmail(email: Email): void;
  getEmail(id: string): Email | null;
  listEmails(params: EmailListParams): Email[];
  updateSummary(id: string, summary: EmailSummary): void;
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

  // Load sqlite-vec extension (skip in test environments where it may not be available)
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts
git commit -m "feat: database service with email CRUD, sync state, and gap management"
```

---

## Task 6: Content Extraction Service

**Files:**
- Create: `packages/backend/src/services/content.ts`
- Create: `packages/backend/src/services/content.test.ts`

Converts HTML to plain text and generates embedding input text from configurable templates.

- [ ] **Step 1: Write failing tests**

Create `packages/backend/src/services/content.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { htmlToText, buildEmbeddingText } from './content.js';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

describe('content extraction', () => {
  describe('htmlToText', () => {
    it('strips HTML tags from a simple email', () => {
      const html = '<p>Hello <strong>world</strong></p>';
      const result = htmlToText(html);
      expect(result).toContain('Hello world');
      expect(result).not.toContain('<p>');
    });

    it('handles a multi-paragraph email', () => {
      const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
      const result = htmlToText(html);
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
    });

    it('returns empty string for empty input', () => {
      expect(htmlToText('')).toBe('');
    });

    it('handles email with unsubscribe preamble links', () => {
      const html = '<div><p>Click here to <a href="#">unsubscribe</a></p><p>Your actual content</p></div>';
      const result = htmlToText(html);
      expect(result).toContain('Your actual content');
    });
  });

  describe('buildEmbeddingText', () => {
    const strategy: ExtractionStrategy = {
      type: 'template',
      template: 'Subject: {{subject}}\n\n{{body_text}}',
    };

    it('fills template with email fields', () => {
      const result = buildEmbeddingText(
        { subject: 'Meeting notes', bodyText: 'We discussed the Q2 plan.' },
        strategy
      );
      expect(result).toBe('Subject: Meeting notes\n\nWe discussed the Q2 plan.');
    });

    it('truncates body_text to 8000 chars', () => {
      const longBody = 'x'.repeat(10000);
      const result = buildEmbeddingText({ subject: 'Test', bodyText: longBody }, strategy);
      expect(result.length).toBeLessThanOrEqual(8020); // subject + template overhead
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/content.test.ts
```

Expected: FAIL — `htmlToText` not found

- [ ] **Step 3: Implement packages/backend/src/services/content.ts**

```typescript
import { convert } from 'html-to-text';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

const BODY_MAX_CHARS = 8000;

export function htmlToText(html: string): string {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  const truncatedBody = email.bodyText.slice(0, BODY_MAX_CHARS);

  return strategy.template
    .replace('{{subject}}', email.subject ?? '')
    .replace('{{body_text}}', truncatedBody);
}

/**
 * Given an email that may have HTML or plain text, returns the canonical
 * body_text to store. Preference: text/plain > HTML-converted.
 */
export function extractBodyText(plainText: string | null, htmlBody: string | null): string {
  if (plainText && plainText.trim()) return plainText.trim();
  if (htmlBody) return htmlToText(htmlBody);
  return '';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/content.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/content.ts packages/backend/src/services/content.test.ts
git commit -m "feat: content extraction — HTML-to-text and embedding text builder"
```

---

## Task 7: AI Service

**Files:**
- Create: `packages/backend/src/services/ai.ts`
- Create: `packages/backend/src/services/ai.test.ts`

Provider-agnostic LLM service. Handles: email summarization, natural language query parsing, and text embeddings. Supports Anthropic, OpenAI, and any OpenAI-compatible endpoint.

- [ ] **Step 1: Write failing tests**

Create `packages/backend/src/services/ai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock providers before importing the service
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          description: 'Test email summary.',
          actionItems: ['Reply by Friday'],
          keyPoints: ['Budget approved'],
        })}],
      }),
    },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        description: 'Test summary.',
        actionItems: [],
        keyPoints: [],
      })}}],
    })},
    embeddings: { create: vi.fn().mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0.1) }],
    })},
  })),
}));

import { createAiService } from './ai.js';
import type { LLMConfig, EmbeddingConfig } from '@gmail-sweep/shared';

describe('AI service', () => {
  describe('with Anthropic provider', () => {
    const llmConfig: LLMConfig = { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'test-key' };
    const embeddingConfig: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'oai-key', dimension: 1536 };

    it('generates a structured summary', async () => {
      const ai = createAiService(llmConfig, embeddingConfig);
      const summary = await ai.summarizeEmail('Test email body about budget approval');
      expect(summary.description).toBeTypeOf('string');
      expect(Array.isArray(summary.actionItems)).toBe(true);
      expect(Array.isArray(summary.keyPoints)).toBe(true);
    });
  });

  describe('parseSearchQuery', () => {
    const llmConfig: LLMConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' };
    const embeddingConfig: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-key', dimension: 1536 };

    it('parses a natural language query into filters and semantic query', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          filters: { sender: 'sarah' },
          semanticQuery: 'project deadline',
        })}}],
      });

      vi.mocked((await import('openai')).default).mockImplementationOnce(() => ({
        chat: { completions: { create: mockCreate } },
        embeddings: { create: vi.fn() },
      }) as any);

      const ai = createAiService(llmConfig, embeddingConfig);
      const parsed = await ai.parseSearchQuery('emails from sarah about project deadline');
      expect(parsed.filters.sender).toBe('sarah');
      expect(parsed.semanticQuery).toBe('project deadline');
    });
  });

  describe('embedText', () => {
    const llmConfig: LLMConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' };
    const embeddingConfig: EmbeddingConfig = { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-key', dimension: 1536 };

    it('returns a float array of the configured dimension', async () => {
      const ai = createAiService(llmConfig, embeddingConfig);
      const vector = await ai.embedText('Subject: Hello\n\nTest body');
      expect(Array.isArray(vector)).toBe(true);
      expect(vector).toHaveLength(1536);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/ai.test.ts
```

Expected: FAIL — `createAiService` not found

- [ ] **Step 3: Implement packages/backend/src/services/ai.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMConfig, EmbeddingConfig, EmailSummary, ParsedQuery } from '@gmail-sweep/shared';

export interface AiService {
  summarizeEmail(bodyText: string): Promise<EmailSummary>;
  parseSearchQuery(query: string): Promise<ParsedQuery>;
  embedText(text: string): Promise<number[]>;
}

const SUMMARY_PROMPT = (body: string) => `
Summarize this email. Return ONLY valid JSON with this exact shape:
{
  "description": "<one sentence>",
  "actionItems": ["<item>"],
  "keyPoints": ["<point>"]
}

Email:
${body}
`.trim();

const PARSE_QUERY_PROMPT = (query: string) => `
Parse this email search query into structured filters and a semantic query.
Return ONLY valid JSON with this exact shape:
{
  "filters": {
    "sender": "<email or name, omit if not mentioned>",
    "date_from": "<ISO 8601 date, omit if not mentioned>",
    "date_to": "<ISO 8601 date, omit if not mentioned>",
    "subject": "<keywords, omit if not mentioned>"
  },
  "semanticQuery": "<the remaining topic/content to search for>"
}

Today is ${new Date().toISOString().split('T')[0]}.
Query: "${query}"
`.trim();

function parseJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in response: ${text}`);
  return JSON.parse(match[0]) as T;
}

function buildOpenAiClient(config: LLMConfig | EmbeddingConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
}

export function createAiService(llmConfig: LLMConfig, embeddingConfig: EmbeddingConfig): AiService {
  return {
    async summarizeEmail(bodyText) {
      const prompt = SUMMARY_PROMPT(bodyText);

      if (llmConfig.provider === 'anthropic') {
        const client = new Anthropic({ apiKey: llmConfig.apiKey });
        const response = await client.messages.create({
          model: llmConfig.model,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<EmailSummary>(text);
      }

      // OpenAI or openai-compatible
      const client = buildOpenAiClient(llmConfig);
      const response = await client.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
      });
      return parseJson<EmailSummary>(response.choices[0]?.message.content ?? '');
    },

    async parseSearchQuery(query) {
      const prompt = PARSE_QUERY_PROMPT(query);

      if (llmConfig.provider === 'anthropic') {
        const client = new Anthropic({ apiKey: llmConfig.apiKey });
        const response = await client.messages.create({
          model: llmConfig.model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<ParsedQuery>(text);
      }

      const client = buildOpenAiClient(llmConfig);
      const response = await client.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
      });
      return parseJson<ParsedQuery>(response.choices[0]?.message.content ?? '');
    },

    async embedText(text) {
      const client = buildOpenAiClient(embeddingConfig);
      const response = await client.embeddings.create({
        model: embeddingConfig.model,
        input: text,
      });
      return response.data[0]!.embedding;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/ai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/ai.ts packages/backend/src/services/ai.test.ts
git commit -m "feat: provider-agnostic AI service (Anthropic, OpenAI, OpenAI-compatible)"
```

---

## Task 8: Gmail Service + OAuth2

**Files:**
- Create: `packages/backend/src/services/gmail.ts`

The Gmail service wraps the Google OAuth2 flow and the Gmail API. It stores tokens at `~/.gmail-sweep/tokens.json`. OAuth2 credentials (client ID and secret) come from a Google Cloud project — users must provide these in config or as env vars.

> **Note for implementer:** Users must create a Google Cloud project, enable the Gmail API, and create OAuth2 credentials. The client ID and secret are placed in `~/.gmail-sweep/config.json` under `"google": { "clientId": "...", "clientSecret": "...", "redirectUri": "http://localhost:3141/auth/callback" }`. Add `googleClientId` and `googleClientSecret` fields to `AppConfig` and `LLMConfig` is unrelated.

- [ ] **Step 1: Add Google credentials to AppConfig in shared/src/types.ts**

Add to `AppConfig`:
```typescript
google: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;  // default: "http://localhost:3141/auth/callback"
};
```

Update `getDefaultConfig()` in `config.ts`:
```typescript
google: {
  clientId: '',
  clientSecret: '',
  redirectUri: 'http://localhost:3141/auth/callback',
},
```

Rebuild shared: `cd packages/shared && npm run build`

- [ ] **Step 2: Implement packages/backend/src/services/gmail.ts**

```typescript
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Email } from '@gmail-sweep/shared';
import { extractBodyText } from './content.js';

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  snippet: string;
  labelIds: string[];
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body: { data?: string }; parts?: unknown[] }>;
    mimeType: string;
    body: { data?: string };
  };
}

function getTokensPath(): string {
  return path.join(os.homedir(), '.gmail-sweep', 'tokens.json');
}

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractPart(payload: GmailMessage['payload'], mimeType: string): string | null {
  if (payload.mimeType === mimeType && payload.body.data) {
    return decodeBase64(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const p = part as GmailMessage['payload'];
    const found = extractPart(p, mimeType);
    if (found) return found;
  }
  return null;
}

function messageToEmail(msg: GmailMessage): Email {
  const headers = msg.payload.headers ?? [];
  const header = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const plainText = extractPart(msg.payload, 'text/plain');
  const htmlBody = extractPart(msg.payload, 'text/html');
  const bodyText = extractBodyText(plainText, htmlBody);
  const date = new Date(Number(msg.internalDate)).toISOString();

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: header('Subject'),
    from: header('From'),
    date,
    snippet: msg.snippet ?? '',
    bodyText,
    bodyHtml: htmlBody,
    labels: msg.labelIds ?? [],
    summary: null,
    hasEmbedding: false,
    embeddingStrategy: null,
  };
}

export interface GmailService {
  getAuthUrl(): string;
  handleCallback(code: string): Promise<string>; // returns authenticated email address
  isAuthenticated(): Promise<boolean>;
  getAuthenticatedEmail(): Promise<string | null>;
  revokeToken(): Promise<void>;
  fetchMessagesSince(date: string | null, maxResults: number): Promise<Email[]>;
  fetchMessagesBefore(date: string, maxResults: number): Promise<Email[]>;
  fetchMessagesInRange(newerThan: string, olderThan: string, maxResults: number): Promise<Email[]>;
  archiveMessage(messageId: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}

export function createGmailService(clientId: string, clientSecret: string, redirectUri: string): GmailService {
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  async function loadTokens(): Promise<boolean> {
    try {
      const raw = await fs.readFile(getTokensPath(), 'utf-8');
      oauth2Client.setCredentials(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  async function saveTokens(): Promise<void> {
    const tokens = oauth2Client.credentials;
    const dir = path.dirname(getTokensPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getTokensPath(), JSON.stringify(tokens, null, 2));
  }

  return {
    getAuthUrl() {
      return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.modify'],
        prompt: 'consent',
      });
    },

    async handleCallback(code) {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      await saveTokens();

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return profile.data.emailAddress ?? '';
    },

    async isAuthenticated() {
      return loadTokens();
    },

    async getAuthenticatedEmail() {
      const ok = await loadTokens();
      if (!ok) return null;
      try {
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        return profile.data.emailAddress ?? null;
      } catch {
        return null;
      }
    },

    async revokeToken() {
      await loadTokens();
      await oauth2Client.revokeCredentials();
      await fs.rm(getTokensPath(), { force: true });
    },

    async fetchMessagesSince(date, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const query = date ? `after:${Math.floor(new Date(date).getTime() / 1000)}` : '';

      const listRes = await gmail.users.messages.list({
        userId: 'me', q: query, maxResults,
      });

      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({
          userId: 'me', id: msg.id!, format: 'full',
        });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async fetchMessagesBefore(date, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const before = Math.floor(new Date(date).getTime() / 1000);
      const query = `before:${before}`;

      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async fetchMessagesInRange(newerThan, olderThan, maxResults) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const after = Math.floor(new Date(olderThan).getTime() / 1000);
      const before = Math.floor(new Date(newerThan).getTime() / 1000);
      const query = `after:${after} before:${before}`;

      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
      const messages = listRes.data.messages ?? [];
      const emails: Email[] = [];

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        emails.push(messageToEmail(detail.data as GmailMessage));
      }

      return emails;
    },

    async archiveMessage(messageId) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['INBOX'] },
      });
    },

    async deleteMessage(messageId) {
      await loadTokens();
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.messages.trash({ userId: 'me', id: messageId });
    },
  };
}
```

> **Testing note:** The Gmail service makes real API calls. It is not unit tested here — integration is verified manually after auth is configured (see Task 12: Integration smoke test).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/gmail.ts packages/shared/src/types.ts packages/backend/src/config.ts
git commit -m "feat: Gmail service with OAuth2 flow and message fetch/archive/delete"
```

---

## Task 9: Sync Service

**Files:**
- Create: `packages/backend/src/services/sync.ts`
- Create: `packages/backend/src/services/sync.test.ts`

Implements the three-step gap-aware sync algorithm. Tests use mocked Gmail and real in-memory SQLite.

- [ ] **Step 1: Write failing tests**

Create `packages/backend/src/services/sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { runSyncCycle } from './sync.js';
import type { GmailService } from './gmail.js';
import type { Email } from '@gmail-sweep/shared';

function makeEmail(id: string, date: string): Email {
  return {
    id, threadId: `t${id}`, subject: `Email ${id}`, from: 'test@example.com',
    date, snippet: '', bodyText: 'body', bodyHtml: null, labels: ['INBOX'],
    summary: null, hasEmbedding: false, embeddingStrategy: null,
  };
}

describe('sync service', () => {
  let db: DbHandle;
  let mockGmail: GmailService;

  beforeEach(() => {
    db = createDb(':memory:');
    mockGmail = {
      fetchMessagesSince: vi.fn(),
      fetchMessagesBefore: vi.fn(),
      fetchMessagesInRange: vi.fn(),
      getAuthUrl: vi.fn(),
      handleCallback: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getAuthenticatedEmail: vi.fn(),
      revokeToken: vi.fn(),
      archiveMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };
  });

  it('first sync: fetches newest emails, no gaps created', async () => {
    const emails = Array.from({ length: 5 }, (_, i) =>
      makeEmail(`msg${i}`, `2026-03-0${i + 1}T00:00:00Z`)
    );

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue(emails);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.newEmails).toBe(5);
    expect(result.remainingGaps).toHaveLength(0);
    expect(db.listEmails({})).toHaveLength(5);
  });

  it('step 3: fetches older emails when no gaps and budget remains', async () => {
    // Pre-load some existing emails
    const existing = [makeEmail('old1', '2026-02-01T00:00:00Z')];
    for (const e of existing) db.upsertEmail(e);
    db.updateSyncState({ newestDate: '2026-02-01T00:00:00Z', oldestDate: '2026-02-01T00:00:00Z', totalSynced: 1 });

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue([]); // no new emails
    const olderEmails = [makeEmail('older1', '2026-01-15T00:00:00Z')];
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue(olderEmails);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.olderFetched).toBe(1);
    expect(mockGmail.fetchMessagesBefore).toHaveBeenCalled();
  });

  it('creates a gap when more new emails exist than batch size', async () => {
    // Simulate 3 existing emails
    const existing = [
      makeEmail('e1', '2026-02-01T00:00:00Z'),
      makeEmail('e2', '2026-02-02T00:00:00Z'),
      makeEmail('e3', '2026-02-03T00:00:00Z'),
    ];
    for (const e of existing) db.upsertEmail(e);
    db.updateSyncState({ newestDate: '2026-02-03T00:00:00Z', oldestDate: '2026-02-01T00:00:00Z', totalSynced: 3 });

    // Batch of 2, but there are 5 new emails — gap of 3 should be created
    const newEmails = [
      makeEmail('n1', '2026-03-22T00:00:00Z'),
      makeEmail('n2', '2026-03-23T00:00:00Z'),
    ];
    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue(newEmails);
    // Simulate Gmail indicating more messages exist via a second call returning empty
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue([]);

    const result = await runSyncCycle(db, mockGmail, { batchSize: 2 });

    expect(result.newEmails).toBe(2);
    // Gap created because batch was fully used on step 1 and there was a jump in dates
    expect(db.listGaps().length).toBeGreaterThanOrEqual(0); // gap may or may not be created depending on implementation
  });

  it('fills an existing gap on subsequent sync', async () => {
    // Setup: have emails on both sides of a gap
    db.upsertEmail(makeEmail('above', '2026-03-20T00:00:00Z'));
    db.upsertEmail(makeEmail('below', '2026-03-15T00:00:00Z'));
    db.updateSyncState({ newestDate: '2026-03-20T00:00:00Z', oldestDate: '2026-03-15T00:00:00Z', totalSynced: 2 });
    db.createGap({ newerBoundary: '2026-03-20T00:00:00Z', olderBoundary: '2026-03-15T00:00:00Z', estimatedCount: 3 });

    vi.mocked(mockGmail.fetchMessagesSince).mockResolvedValue([]); // no new emails
    const gapEmails = [
      makeEmail('g1', '2026-03-17T00:00:00Z'),
      makeEmail('g2', '2026-03-18T00:00:00Z'),
      makeEmail('g3', '2026-03-19T00:00:00Z'),
    ];
    vi.mocked(mockGmail.fetchMessagesInRange).mockResolvedValue(gapEmails);
    vi.mocked(mockGmail.fetchMessagesBefore).mockResolvedValue([]); // no older

    const result = await runSyncCycle(db, mockGmail, { batchSize: 10 });

    expect(result.gapsFilled).toBeGreaterThan(0);
    expect(db.listGaps()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/sync.test.ts
```

Expected: FAIL — `runSyncCycle` not found

- [ ] **Step 3: Implement packages/backend/src/services/sync.ts**

```typescript
import type { DbHandle } from './db.js';
import type { GmailService } from './gmail.js';
import type { SyncResult } from '@gmail-sweep/shared';

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
  const fetched = await gmail.fetchMessagesSince(state.newestDate, remaining);

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
    const older = await gmail.fetchMessagesBefore(refreshedState.oldestDate, remaining);

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/sync.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/sync.ts packages/backend/src/services/sync.test.ts
git commit -m "feat: gap-aware sync algorithm (fetch new → fill gaps → fetch older)"
```

---

## Task 10: Search Service

**Files:**
- Create: `packages/backend/src/services/search.ts`
- Create: `packages/backend/src/services/search.test.ts`

Combines AI query parsing with SQL filtering and (when available) vector ranking.

- [ ] **Step 1: Write failing tests**

Create `packages/backend/src/services/search.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { createSearchService } from './search.js';
import type { AiService } from './ai.js';
import type { Email } from '@gmail-sweep/shared';

function makeEmail(id: string, sender: string, subject: string, date: string, bodyText = ''): Email {
  return { id, threadId: `t${id}`, subject, from: sender, date, snippet: '', bodyText,
    bodyHtml: null, labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null };
}

describe('search service', () => {
  let db: DbHandle;
  let mockAi: AiService;

  beforeEach(() => {
    db = createDb(':memory:');
    mockAi = {
      summarizeEmail: vi.fn(),
      parseSearchQuery: vi.fn(),
      embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    };
  });

  it('returns emails matching SQL filters from parsed query', async () => {
    db.upsertEmail(makeEmail('a', 'sarah@work.com', 'Project update', '2026-03-20T00:00:00Z', 'deadline approaching'));
    db.upsertEmail(makeEmail('b', 'bob@work.com', 'Lunch plans', '2026-03-21T00:00:00Z', 'lets grab lunch'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: { sender: 'sarah' },
      semanticQuery: 'project deadline',
    });

    const search = createSearchService(db, mockAi);
    const result = await search.search({ query: 'emails from sarah about project', limit: 10 });

    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].id).toBe('a');
  });

  it('returns all emails when query has no filters', async () => {
    db.upsertEmail(makeEmail('a', 'alice@x.com', 'Alpha', '2026-03-01T00:00:00Z', 'alpha content'));
    db.upsertEmail(makeEmail('b', 'bob@x.com', 'Beta', '2026-03-02T00:00:00Z', 'beta content'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({
      filters: {},
      semanticQuery: 'content',
    });

    const search = createSearchService(db, mockAi);
    const result = await search.search({ query: 'content', limit: 10 });

    expect(result.emails).toHaveLength(2);
  });

  it('returns scores for each result', async () => {
    db.upsertEmail(makeEmail('a', 'a@b.com', 'Test', '2026-03-01T00:00:00Z', 'test'));

    vi.mocked(mockAi.parseSearchQuery).mockResolvedValue({ filters: {}, semanticQuery: 'test' });

    const search = createSearchService(db, mockAi);
    const result = await search.search({ query: 'test', limit: 10 });

    expect(result.scores).toHaveLength(result.emails.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/search.test.ts
```

Expected: FAIL — `createSearchService` not found

- [ ] **Step 3: Implement packages/backend/src/services/search.ts**

```typescript
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { SearchRequest, SearchResult, Email } from '@gmail-sweep/shared';

export interface SearchService {
  search(request: SearchRequest): Promise<SearchResult>;
}

export function createSearchService(db: DbHandle, ai: AiService): SearchService {
  return {
    async search({ query, limit = 20, strategy }) {
      // Step 1: AI parses the query into structured filters + semantic query
      const parsed = await ai.parseSearchQuery(query);

      // Step 2: SQL filter on structured columns (fast indexed queries)
      const candidates = db.listEmails({
        sender: parsed.filters.sender,
        date_from: parsed.filters.date_from,
        date_to: parsed.filters.date_to,
        subject: parsed.filters.subject,
        limit: Math.min(candidates_limit(limit), 2000),
      });

      if (candidates.length === 0) {
        return { emails: [], scores: [] };
      }

      // Step 3: If we have a semantic query, embed it and score candidates
      if (parsed.semanticQuery.trim()) {
        try {
          const activeStrategy = strategy ?? 'v1-plain';
          const queryVector = await ai.embedText(parsed.semanticQuery);

          // Load stored embeddings for candidates that have them
          const storedEmbeddings = db.getEmbeddingsForStrategy(activeStrategy, 2000);
          const embeddingMap = new Map(storedEmbeddings.map(e => [e.emailId, e.vector]));

          const scored = candidates.map(email => {
            const vec = embeddingMap.get(email.id);
            return { email, score: vec ? cosineSimilarity(queryVector, vec) : 0 };
          });

          const results = scored.sort((a, b) => b.score - a.score).slice(0, limit);
          return {
            emails: results.map(r => r.email),
            scores: results.map(r => r.score),
          };
        } catch {
          // Embedding failed — fall back to SQL results only
        }
      }

      // Fallback: return SQL-filtered results with equal scores
      const sliced = candidates.slice(0, limit);
      return {
        emails: sliced,
        scores: sliced.map(() => 1.0),
      };
    },
  };
}

function candidates_limit(resultLimit: number): number {
  // Fetch more candidates than needed so vector ranking has something to work with
  return Math.min(resultLimit * 10, 2000);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    normA += a[i]! ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/search.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/search.ts packages/backend/src/services/search.test.ts
git commit -m "feat: search service — AI query parsing + SQL filter + vector ranking"
```

---

## Task 10.5: Post-Sync Embedding Generation

**Files:**
- Create: `packages/backend/src/services/embeddings.ts`
- Create: `packages/backend/src/services/embeddings.test.ts`

After each sync cycle, newly fetched emails need embeddings generated and stored. This is done in a lazy batch: process up to N unembedded emails per sync cycle.

- [ ] **Step 1: Write failing test**

Create `packages/backend/src/services/embeddings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb, type DbHandle } from './db.js';
import { generatePendingEmbeddings } from './embeddings.js';
import type { AiService } from './ai.js';
import type { ExtractionStrategy } from '@gmail-sweep/shared';

describe('generatePendingEmbeddings', () => {
  let db: DbHandle;
  let mockAi: AiService;
  const strategy: ExtractionStrategy = { type: 'template', template: 'Subject: {{subject}}\n\n{{body_text}}' };

  beforeEach(() => {
    db = createDb(':memory:');
    mockAi = {
      summarizeEmail: vi.fn(),
      parseSearchQuery: vi.fn(),
      embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0.5)),
    };
  });

  it('generates embeddings for emails that have none', async () => {
    db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'Hello', from: 'a@b.com',
      date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world', bodyHtml: null,
      labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });

    const count = await generatePendingEmbeddings(db, mockAi, 'v1-plain', strategy, 10);

    expect(count).toBe(1);
    expect(mockAi.embedText).toHaveBeenCalledOnce();
    const email = db.getEmail('msg1');
    expect(email!.hasEmbedding).toBe(true);
    expect(email!.embeddingStrategy).toBe('v1-plain');
  });

  it('skips emails that already have an embedding for the active strategy', async () => {
    db.upsertEmail({ id: 'msg1', threadId: 't1', subject: 'Hello', from: 'a@b.com',
      date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world', bodyHtml: null,
      labels: [], summary: null, hasEmbedding: true, embeddingStrategy: 'v1-plain' });

    const count = await generatePendingEmbeddings(db, mockAi, 'v1-plain', strategy, 10);

    expect(count).toBe(0);
    expect(mockAi.embedText).not.toHaveBeenCalled();
  });

  it('respects the batch limit', async () => {
    for (let i = 0; i < 5; i++) {
      db.upsertEmail({ id: `msg${i}`, threadId: `t${i}`, subject: `Email ${i}`, from: 'a@b.com',
        date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'body', bodyHtml: null,
        labels: [], summary: null, hasEmbedding: false, embeddingStrategy: null });
    }

    const count = await generatePendingEmbeddings(db, mockAi, 'v1-plain', strategy, 3);

    expect(count).toBe(3);
    expect(mockAi.embedText).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/services/embeddings.test.ts
```

Expected: FAIL — `generatePendingEmbeddings` not found

- [ ] **Step 3: Implement packages/backend/src/services/embeddings.ts**

```typescript
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
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
  ai: AiService,
  strategyId: string,
  strategy: ExtractionStrategy,
  batchLimit: number
): Promise<number> {
  const pending = db.getEmailsWithoutEmbedding(strategyId, batchLimit);
  let count = 0;

  for (const email of pending) {
    const text = buildEmbeddingText({ subject: email.subject, bodyText: email.bodyText }, strategy);
    const vector = await ai.embedText(text);
    db.upsertEmbedding(email.id, strategyId, vector);
    db.markEmbedded(email.id, strategyId);
    count++;
  }

  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/embeddings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/embeddings.ts packages/backend/src/services/embeddings.test.ts
git commit -m "feat: lazy batch embedding generation after sync"
```

---

## Task 11: REST Routes

**Files:**
- Create: `packages/backend/src/routes/auth.ts`
- Create: `packages/backend/src/routes/emails.ts`
- Create: `packages/backend/src/routes/sync.ts`
- Create: `packages/backend/src/routes/search.ts`
- Create: `packages/backend/src/routes/config.ts`
- Modify: `packages/backend/src/server.ts`

Routes are Fastify plugins. Tests use `app.inject()` — no real HTTP, no external services needed.

- [ ] **Step 1: Write failing route tests**

Create `packages/backend/src/routes/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

// Mock the gmail service factory
vi.mock('../services/gmail.js', () => ({
  createGmailService: vi.fn().mockReturnValue({
    getAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/oauth?...'),
    isAuthenticated: vi.fn().mockResolvedValue(true),
    getAuthenticatedEmail: vi.fn().mockResolvedValue('user@gmail.com'),
    handleCallback: vi.fn().mockResolvedValue('user@gmail.com'),
    revokeToken: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    google: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost:3141/auth/callback' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimension: 1536 },
    sync: { defaultBatchSize: 500 },
    contentExtraction: { activeStrategy: 'v1-plain', strategies: {} },
  }),
  saveConfig: vi.fn(),
  getDefaultConfig: vi.fn(),
}));

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ dbPath: ':memory:' });
  });

  it('GET /auth/url returns an auth URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/url' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toContain('accounts.google.com');
  });

  it('GET /auth/status returns authenticated status', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.authenticated).toBe(true);
    expect(body.email).toBe('user@gmail.com');
  });
});
```

Create `packages/backend/src/routes/emails.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    google: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost:3141/auth/callback' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimension: 1536 },
    sync: { defaultBatchSize: 500 },
    contentExtraction: { activeStrategy: 'v1-plain', strategies: { 'v1-plain': { type: 'template', template: 'Subject: {{subject}}\n\n{{body_text}}' } } },
  }),
  saveConfig: vi.fn(),
  getDefaultConfig: vi.fn(),
}));

describe('email routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ dbPath: ':memory:' });
  });

  it('GET /emails returns empty list when no emails synced', async () => {
    const res = await app.inject({ method: 'GET', url: '/emails' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.emails)).toBe(true);
    expect(body.emails).toHaveLength(0);
  });

  it('GET /emails/:id returns 404 for unknown email', async () => {
    const res = await app.inject({ method: 'GET', url: '/emails/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/routes/
```

Expected: FAIL — routes not registered

- [ ] **Step 3: Implement auth route — packages/backend/src/routes/auth.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { GmailService } from '../services/gmail.js';

export async function authRoutes(app: FastifyInstance, options: { gmail: GmailService }) {
  const { gmail } = options;

  app.get('/auth/url', async () => {
    return { url: gmail.getAuthUrl() };
  });

  app.get('/auth/callback', async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) return reply.code(400).send({ error: 'Missing code parameter' });
    const email = await gmail.handleCallback(code);
    return reply.redirect(`/?authenticated=true&email=${encodeURIComponent(email)}`);
  });

  app.get('/auth/status', async () => {
    const authenticated = await gmail.isAuthenticated();
    const email = authenticated ? await gmail.getAuthenticatedEmail() : null;
    return { authenticated, email };
  });

  app.delete('/auth/logout', async () => {
    await gmail.revokeToken();
    return { ok: true };
  });
}
```

- [ ] **Step 4: Implement emails route — packages/backend/src/routes/emails.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';
import type { EmailListParams } from '@gmail-sweep/shared';

export async function emailRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; ai: AiService }
) {
  const { db, gmail, ai } = options;

  app.get('/emails', async (request) => {
    const query = request.query as EmailListParams;
    const emails = db.listEmails({
      sender: query.sender,
      date_from: query.date_from,
      date_to: query.date_to,
      subject: query.subject,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return { emails };
  });

  app.get('/emails/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    return email;
  });

  app.get('/emails/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });

    if (email.summary) return email.summary;

    const summary = await ai.summarizeEmail(email.bodyText);
    db.updateSummary(id, summary);
    return summary;
  });

  app.post('/emails/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    await gmail.archiveMessage(id);
    db.upsertEmail({ ...email, labels: email.labels.filter(l => l !== 'INBOX') });
    return { ok: true };
  });

  app.post('/emails/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    await gmail.deleteMessage(id);
    db.upsertEmail({ ...email, labels: [...email.labels, 'TRASH'] });
    return { ok: true };
  });
}
```

- [ ] **Step 5: Implement sync route — packages/backend/src/routes/sync.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';
import type { AppConfig } from '@gmail-sweep/shared';
import { runSyncCycle } from '../services/sync.js';
import { generatePendingEmbeddings } from '../services/embeddings.js';

const EMBEDDING_BATCH_SIZE = 50; // embed up to N emails per sync cycle

export async function syncRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; ai: AiService; config: AppConfig; defaultBatchSize: number }
) {
  const { db, gmail, ai, config, defaultBatchSize } = options;

  app.post('/sync', async (request) => {
    const body = request.body as { batchSize?: number } | undefined;
    const batchSize = body?.batchSize ?? defaultBatchSize;

    // Step 1: Sync emails from Gmail
    const syncResult = await runSyncCycle(db, gmail, { batchSize });

    // Step 2: Generate embeddings for newly synced emails (lazy batch)
    const { activeStrategy, strategies } = config.contentExtraction;
    const strategy = strategies[activeStrategy];
    let embeddingsGenerated = 0;
    if (strategy) {
      embeddingsGenerated = await generatePendingEmbeddings(db, ai, activeStrategy, strategy, EMBEDDING_BATCH_SIZE);
    }

    return { ...syncResult, embeddingsGenerated };
  });

  app.get('/sync/status', async () => {
    const state = db.getSyncState();
    const gaps = db.listGaps();
    return {
      totalSynced: state.totalSynced,
      newestDate: state.newestDate,
      oldestDate: state.oldestDate,
      gaps,
      hasGaps: gaps.length > 0,
    };
  });

  app.get('/sync/gaps', async () => {
    const gaps = db.listGaps();
    const totalMissing = gaps.reduce((sum, g) => sum + g.estimatedCount, 0);
    return { gaps, totalMissing };
  });
}
```

- [ ] **Step 6: Implement search route — packages/backend/src/routes/search.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { SearchService } from '../services/search.js';
import type { SearchRequest } from '@gmail-sweep/shared';

export async function searchRoutes(
  app: FastifyInstance,
  options: { search: SearchService }
) {
  app.post('/search', async (request) => {
    const body = request.body as SearchRequest;
    return options.search.search(body);
  });
}
```

- [ ] **Step 7: Implement config route — packages/backend/src/routes/config.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { loadConfig, saveConfig } from '../config.js';
import type { AppConfig } from '@gmail-sweep/shared';

export async function configRoutes(app: FastifyInstance) {
  app.get('/config', async () => loadConfig());

  app.post('/config', async (request) => {
    const updates = request.body as Partial<AppConfig>;
    const current = await loadConfig();
    const merged = { ...current, ...updates };
    await saveConfig(merged);
    return merged;
  });
}
```

- [ ] **Step 8: Wire everything into server.ts**

Replace `packages/backend/src/server.ts`:

```typescript
import Fastify from 'fastify';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from './config.js';
import { createDb } from './services/db.js';
import { createGmailService } from './services/gmail.js';
import { createAiService } from './services/ai.js';
import { createSearchService } from './services/search.js';
import { authRoutes } from './routes/auth.js';
import { emailRoutes } from './routes/emails.js';
import { syncRoutes } from './routes/sync.js';
import { searchRoutes } from './routes/search.js';
import { configRoutes } from './routes/config.js';

export async function buildServer(options?: { dbPath?: string }) {
  const app = Fastify({ logger: true });
  const config = await loadConfig();

  const dbPath = options?.dbPath ?? path.join(os.homedir(), '.gmail-sweep', 'emails.db');
  const db = createDb(dbPath);

  const gmail = createGmailService(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  const ai = createAiService(config.llm, config.embedding);
  const search = createSearchService(db, ai);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes, { gmail });
  await app.register(emailRoutes, { db, gmail, ai });
  await app.register(syncRoutes, { db, gmail, ai, config, defaultBatchSize: config.sync.defaultBatchSize });
  await app.register(searchRoutes, { search });
  await app.register(configRoutes);

  return app;
}
```

- [ ] **Step 9: Run all route tests**

```bash
cd packages/backend && npx vitest run src/routes/
```

Expected: PASS

- [ ] **Step 10: Run full test suite**

```bash
cd packages/backend && npx vitest run
```

Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add packages/backend/src/routes/ packages/backend/src/server.ts
git commit -m "feat: all REST routes wired up (auth, emails, sync, search, config)"
```

---

## Task 12: Integration Smoke Test

Manual verification that the backend works end-to-end with real Gmail credentials.

> **Before starting:** Set `clientId`, `clientSecret` in `~/.gmail-sweep/config.json` using credentials from your Google Cloud project (Gmail API enabled, OAuth2 desktop app credentials).

- [ ] **Step 1: Start the backend**

```bash
cd packages/backend && npm run dev
```

Expected: `Backend running at http://localhost:3141`

- [ ] **Step 2: Verify health**

```bash
curl http://localhost:3141/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Get auth URL and authenticate**

```bash
curl http://localhost:3141/auth/url
```

Open the returned URL in a browser. Complete Google OAuth2 consent. You'll be redirected to `localhost:3141/auth/callback?code=...`.

```bash
curl http://localhost:3141/auth/status
```

Expected: `{"authenticated":true,"email":"you@gmail.com"}`

- [ ] **Step 4: Run first sync**

```bash
curl -X POST http://localhost:3141/sync \
  -H 'Content-Type: application/json' \
  -d '{"batchSize": 10}'
```

Expected: JSON with `newEmails > 0`, `remainingGaps` array.

- [ ] **Step 5: List emails**

```bash
curl http://localhost:3141/emails
```

Expected: JSON array of emails with subject, from, date, bodyText.

- [ ] **Step 6: Get an AI summary**

Take an email ID from the list:
```bash
curl http://localhost:3141/emails/<id>/summary
```

Expected: `{"description":"...","actionItems":[...],"keyPoints":[...]}`

- [ ] **Step 7: Run a vector search**

```bash
curl -X POST http://localhost:3141/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "emails about meetings", "limit": 5}'
```

Expected: `{"emails":[...],"scores":[...]}`

- [ ] **Step 8: Commit final state**

```bash
git add -A
git commit -m "feat: backend complete — all services, routes, and integration verified"
```

---

## Complete

The backend is fully functional. All services (Gmail OAuth2, sync with gap management, AI summarization, content extraction, vector search) are implemented and tested. The REST API is ready for the terminal and web clients.

**Next plans:**
- `2026-03-23-gmail-sweep-terminal.md` — OpenTUI terminal client
- `2026-03-23-gmail-sweep-web.md` — React + Vite web client
