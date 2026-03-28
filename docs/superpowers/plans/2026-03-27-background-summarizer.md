# Background Summarizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend worker that pre-fetches email summaries after every sync, processing newest-first, with exponential backoff on rate-limit errors, and expose progress to the terminal UI.

**Architecture:** A `SummarizerWorker` service runs as a fire-and-forget async loop in the backend process. After each sync, `syncRoutes` calls `worker.trigger()`. The worker pulls one unsummarised email at a time from the DB (newest-first), calls `getOrCreateSummary`, and retries with exponential backoff on HTTP 429 errors. The terminal polls `GET /summarizer/status` every 5 seconds and renders a progress indicator in the inbox list-pane title.

**Tech Stack:** TypeScript, better-sqlite3 (sync API), Fastify, Vitest, @opentui/core (terminal UI)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types.ts` | Add `SummarizerStatus` type |
| Modify | `packages/backend/src/services/db.ts` | Add `getNextEmailWithoutSummary()` and `countEmailsWithoutSummary()` |
| Modify | `packages/backend/src/services/db.test.ts` | Tests for the two new DB methods |
| Create | `packages/backend/src/services/summarizer.ts` | Worker: `createSummarizerWorker()` factory |
| Create | `packages/backend/src/services/summarizer.test.ts` | Worker unit tests |
| Create | `packages/backend/src/routes/summarizer.ts` | `GET /summarizer/status` route |
| Create | `packages/backend/src/routes/summarizer.test.ts` | Route unit tests |
| Modify | `packages/backend/src/server.ts` | Instantiate worker, register route |
| Modify | `packages/backend/src/routes/sync.ts` | Call `worker.trigger()` after sync |
| Create | `packages/backend/src/routes/sync.test.ts` | Sync route unit tests |
| Modify | `packages/terminal/src/api.ts` | Add `getSummarizerStatus()` |
| Modify | `packages/terminal/src/app.ts` | Add `summarizerStatus` field to `AppState` |
| Modify | `packages/terminal/src/index.ts` | Poll status every 5 s, update state |
| Modify | `packages/terminal/src/views/inbox.ts` | Show pending count in list-pane title |

---

## Task 1: Add `SummarizerStatus` to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the type**

Add after the `SearchResult` interface in `packages/shared/src/types.ts`:

```typescript
export interface SummarizerStatus {
  status: 'running' | 'idle';
  processed: number;  // emails processed in the current run (resets each run)
  pending: number;    // emails without a summary (DB count, snapshot at run start)
}
```

- [ ] **Step 2: Rebuild shared package**

```bash
cd packages/shared && npm run build
```

Expected: exits 0, `dist/` updated.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/dist/
git commit -m "feat(shared): add SummarizerStatus type"
```

---

## Task 2: Add DB methods for emails without summaries

**Files:**
- Modify: `packages/backend/src/services/db.ts`
- Modify: `packages/backend/src/services/db.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/backend/src/services/db.test.ts`, add a new `describe` block (find the existing test file and append after the last `describe`):

```typescript
describe('getNextEmailWithoutSummary / countEmailsWithoutSummary', () => {
  let db: DbHandle;

  beforeEach(() => {
    db = createDb(':memory:');
    db.upsertEmail({
      id: 'a', threadId: 't1', subject: 'Older', from: 'x@x.com',
      date: '2024-01-01T00:00:00.000Z', snippet: '', bodyText: 'body',
      bodyHtml: null, labels: [], summary: null,
      hasEmbedding: false, embeddingStrategy: null,
    });
    db.upsertEmail({
      id: 'b', threadId: 't2', subject: 'Newer', from: 'y@y.com',
      date: '2024-06-01T00:00:00.000Z', snippet: '', bodyText: 'body',
      bodyHtml: null, labels: [], summary: null,
      hasEmbedding: false, embeddingStrategy: null,
    });
  });

  it('returns the newest email without a summary', () => {
    const email = db.getNextEmailWithoutSummary();
    expect(email?.id).toBe('b');
  });

  it('returns null when all emails have summaries', () => {
    const summary = { description: 'd', actionItems: [], keyPoints: [] };
    db.updateSummary('a', summary);
    db.updateSummary('b', summary);
    expect(db.getNextEmailWithoutSummary()).toBeNull();
  });

  it('counts emails without summaries', () => {
    expect(db.countEmailsWithoutSummary()).toBe(2);
    db.updateSummary('a', { description: 'd', actionItems: [], keyPoints: [] });
    expect(db.countEmailsWithoutSummary()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: 3 new tests fail with `db.getNextEmailWithoutSummary is not a function` (or similar).

- [ ] **Step 3: Add methods to DbHandle interface**

In `packages/backend/src/services/db.ts`, add to the `DbHandle` interface (after `getEmailsWithoutEmbedding`):

```typescript
  getNextEmailWithoutSummary(): Email | null;
  countEmailsWithoutSummary(): number;
```

- [ ] **Step 4: Implement the methods**

In `packages/backend/src/services/db.ts`, add inside the `createDb` return object (after `getEmailsWithoutEmbedding`):

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts
git commit -m "feat(db): add getNextEmailWithoutSummary and countEmailsWithoutSummary"
```

---

## Task 3: Create the summarizer worker service

**Files:**
- Create: `packages/backend/src/services/summarizer.ts`
- Create: `packages/backend/src/services/summarizer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/services/summarizer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';

// Mock email-ops so getOrCreateSummary is controllable
vi.mock('./email-ops.js', () => ({
  getOrCreateSummary: vi.fn().mockResolvedValue({
    description: 'summary', actionItems: [], keyPoints: [],
  }),
}));

import { createSummarizerWorker } from './summarizer.js';
import { getOrCreateSummary } from './email-ops.js';

const mockEmail = {
  id: 'e1', threadId: 't1', subject: 'Hi', from: 'a@a.com',
  date: '2024-01-01T00:00:00.000Z', snippet: '', bodyText: 'body',
  bodyHtml: null, labels: [], summary: null,
  hasEmbedding: false, embeddingStrategy: null,
};

function makeDb(emailSequence: (typeof mockEmail | null)[]): DbHandle {
  let callCount = 0;
  return {
    getNextEmailWithoutSummary: vi.fn(() => emailSequence[callCount++] ?? null),
    countEmailsWithoutSummary: vi.fn().mockReturnValue(emailSequence.filter(Boolean).length),
  } as unknown as DbHandle;
}

function makeAi(): AiService {
  return {
    summarizeEmail: vi.fn().mockResolvedValue({ description: 'd', actionItems: [], keyPoints: [] }),
    parseSearchQuery: vi.fn(),
  } as unknown as AiService;
}

describe('SummarizerWorker', () => {
  beforeEach(() => {
    vi.mocked(getOrCreateSummary).mockResolvedValue({
      description: 'summary', actionItems: [], keyPoints: [],
    });
  });

  it('is idle with zero processed before trigger is called', () => {
    const worker = createSummarizerWorker(makeDb([null]), makeAi());
    const s = worker.getStatus();
    expect(s.status).toBe('idle');
    expect(s.processed).toBe(0);
  });

  it('processes all emails without summaries then stops', async () => {
    const db = makeDb([mockEmail, { ...mockEmail, id: 'e2' }, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    // Drain the microtask/promise queue
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vi.mocked(getOrCreateSummary)).toHaveBeenCalledTimes(2);
    const s = worker.getStatus();
    expect(s.status).toBe('idle');
    expect(s.processed).toBe(2);
  });

  it('reports status=running and increments processed mid-run', async () => {
    let resolveSummary!: () => void;
    vi.mocked(getOrCreateSummary).mockImplementationOnce(
      () => new Promise(resolve => { resolveSummary = () => resolve({ description: 'd', actionItems: [], keyPoints: [] }); })
    );
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    await new Promise(resolve => setTimeout(resolve, 0)); // let run() start

    expect(worker.getStatus().status).toBe('running');
    expect(worker.getStatus().processed).toBe(0); // not yet resolved

    resolveSummary();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(worker.getStatus().status).toBe('idle');
    expect(worker.getStatus().processed).toBe(1);
  });

  it('does not start a second run if already running', async () => {
    // Make the first email's summary take a tick so the worker stays running
    vi.mocked(getOrCreateSummary).mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve({ description: 'd', actionItems: [], keyPoints: [] }), 50))
    );
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    worker.trigger(); // second call — should be ignored

    await new Promise(resolve => setTimeout(resolve, 100));
    // getNextEmailWithoutSummary called once (for e1) then once more (returns null) = 2 total
    expect(db.getNextEmailWithoutSummary).toHaveBeenCalledTimes(2);
  });

  it('waits with exponential backoff on rate-limit errors', async () => {
    vi.useFakeTimers();

    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    vi.mocked(getOrCreateSummary)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ description: 'd', actionItems: [], keyPoints: [] });

    // Return the same email twice (first attempt fails, second succeeds)
    const db = makeDb([mockEmail, mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());

    worker.trigger();
    // Let the first attempt fail
    await vi.runAllTilesAsync();
    // Advance by the initial 2 s backoff
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runAllTilesAsync();

    expect(vi.mocked(getOrCreateSummary)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('returns pending count snapshot from db taken at run start', () => {
    const db = makeDb([mockEmail, null]);
    const worker = createSummarizerWorker(db, makeAi());
    expect(worker.getStatus().pending).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/summarizer.test.ts
```

Expected: all 6 tests fail with `Cannot find module './summarizer.js'`.

- [ ] **Step 3: Implement the summarizer worker**

Create `packages/backend/src/services/summarizer.ts`:

```typescript
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import { getOrCreateSummary } from './email-ops.js';
import type { SummarizerStatus } from '@gmail-sweep/shared';

export interface SummarizerWorker {
  trigger(): void;
  getStatus(): SummarizerStatus;
}

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 64_000;

function isRateLimitError(err: unknown): boolean {
  return (err as { status?: number })?.status === 429;
}

export function createSummarizerWorker(db: DbHandle, ai: AiService): SummarizerWorker {
  let currentStatus: 'running' | 'idle' = 'idle';
  let processed = 0;
  let pending = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  async function run(): Promise<void> {
    currentStatus = 'running';
    processed = 0;
    pending = db.countEmailsWithoutSummary();
    while (true) {
      const email = db.getNextEmailWithoutSummary();
      if (!email) break;
      try {
        await getOrCreateSummary(db, ai, email.id);
        processed++;
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (err) {
        if (isRateLimitError(err)) {
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
        // non-rate-limit errors: skip email and continue
      }
    }
    currentStatus = 'idle';
  }

  return {
    trigger() {
      if (currentStatus === 'idle') { run(); }
    },
    getStatus(): SummarizerStatus {
      return { status: currentStatus, processed, pending };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/summarizer.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/summarizer.ts packages/backend/src/services/summarizer.test.ts
git commit -m "feat(backend): add background summarizer worker with exponential backoff"
```

---

## Task 4: Add summarizer status HTTP route

**Files:**
- Create: `packages/backend/src/routes/summarizer.ts`
- Create: `packages/backend/src/routes/summarizer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/routes/summarizer.test.ts`. Register `summarizerRoutes` directly on a bare Fastify instance with a mock `SummarizerWorker` — do not use `buildServer`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { summarizerRoutes } from './summarizer.js';
import type { SummarizerWorker } from '../services/summarizer.js';

function makeWorker(overrides: Partial<ReturnType<SummarizerWorker['getStatus']>> = {}): SummarizerWorker {
  return {
    trigger: vi.fn(),
    getStatus: vi.fn().mockReturnValue({
      status: 'idle',
      processed: 0,
      pending: 0,
      ...overrides,
    }),
  };
}

describe('GET /summarizer/status', () => {
  it('returns idle status with zeros when worker is not running', async () => {
    const app = Fastify();
    await app.register(summarizerRoutes, { summarizer: makeWorker() });

    const res = await app.inject({ method: 'GET', url: '/summarizer/status' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'idle', processed: 0, pending: 0 });
  });

  it('returns running status with counts when worker is active', async () => {
    const app = Fastify();
    await app.register(summarizerRoutes, { summarizer: makeWorker({ status: 'running', processed: 2, pending: 5 }) });

    const res = await app.inject({ method: 'GET', url: '/summarizer/status' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'running', processed: 2, pending: 5 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/routes/summarizer.test.ts
```

Expected: 2 tests fail with `Cannot find module './summarizer.js'`.

- [ ] **Step 3: Create the route**

Create `packages/backend/src/routes/summarizer.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { SummarizerWorker } from '../services/summarizer.js';

export async function summarizerRoutes(
  app: FastifyInstance,
  options: { summarizer: SummarizerWorker }
) {
  const { summarizer } = options;

  app.get('/summarizer/status', async () => {
    return summarizer.getStatus();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/routes/summarizer.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/summarizer.ts packages/backend/src/routes/summarizer.test.ts
git commit -m "feat(backend): add GET /summarizer/status route"
```

---

## Task 5: Wire summarizer into server and sync

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/routes/sync.ts`
- Create: `packages/backend/src/routes/sync.test.ts`

- [ ] **Step 1: Write failing tests for sync route**

Create `packages/backend/src/routes/sync.test.ts`. Register `syncRoutes` directly on a bare Fastify instance with mocked dependencies — do not use `buildServer`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { syncRoutes } from './sync.js';
import type { SummarizerWorker } from '../services/summarizer.js';

vi.mock('../services/sync.js', () => ({
  runSyncWithEmbeddings: vi.fn(),
}));

import { runSyncWithEmbeddings } from '../services/sync.js';

const mockSyncResult = { synced: 10, skipped: 0, embedded: 10 };

function makeDeps(summarizerOverrides?: Partial<SummarizerWorker>) {
  return {
    db: {} as any,
    gmail: {} as any,
    embed: {} as any,
    config: {} as any,
    defaultBatchSize: 500,
    summarizer: {
      trigger: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ status: 'idle', processed: 0, pending: 0 }),
      ...summarizerOverrides,
    } as SummarizerWorker,
  };
}

describe('POST /sync', () => {
  it('calls summarizer.trigger() after a successful sync', async () => {
    vi.mocked(runSyncWithEmbeddings).mockResolvedValueOnce(mockSyncResult);
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    await app.inject({ method: 'POST', url: '/sync' });
    expect(deps.summarizer.trigger).toHaveBeenCalledOnce();
  });

  it('does NOT call summarizer.trigger() if sync throws', async () => {
    vi.mocked(runSyncWithEmbeddings).mockRejectedValueOnce(new Error('gmail down'));
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    await app.inject({ method: 'POST', url: '/sync' });
    expect(deps.summarizer.trigger).not.toHaveBeenCalled();
  });

  it('returns the sync result', async () => {
    vi.mocked(runSyncWithEmbeddings).mockResolvedValueOnce(mockSyncResult);
    const deps = makeDeps();
    const app = Fastify();
    await app.register(syncRoutes, deps);

    const res = await app.inject({ method: 'POST', url: '/sync' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockSyncResult);
  });
});
```

- [ ] **Step 1b: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/routes/sync.test.ts
```

Expected: all 3 tests fail (module not yet updated).

- [ ] **Step 2: Update server.ts**

In `packages/backend/src/server.ts`, add the imports and wire up:

```typescript
// Add these imports after the existing imports:
import { createSummarizerWorker } from './services/summarizer.js';
import { summarizerRoutes } from './routes/summarizer.js';
```

After `const search = createSearchService(db, ai, embed);`, add:

```typescript
  const summarizer = createSummarizerWorker(db, ai);
```

After the existing `app.register` calls, add:

```typescript
  await app.register(summarizerRoutes, { summarizer });
```

And pass `summarizer` into `syncRoutes`:

```typescript
  await app.register(syncRoutes, { db, gmail, embed, config, defaultBatchSize: config.sync.defaultBatchSize, summarizer });
```

- [ ] **Step 3: Update sync route to trigger the worker**

In `packages/backend/src/routes/sync.ts`, update the options type and the POST handler:

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { EmbedService } from '../services/embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import type { SummarizerWorker } from '../services/summarizer.js';
import { runSyncWithEmbeddings } from '../services/sync.js';

export async function syncRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; embed: EmbedService; config: AppConfig; defaultBatchSize: number; summarizer: SummarizerWorker }
) {
  const { db, gmail, embed, config, defaultBatchSize, summarizer } = options;

  app.post('/sync', async (request) => {
    const body = request.body as { batchSize?: number; skipEmbeddings?: boolean } | undefined;
    const batchSize = body?.batchSize ?? defaultBatchSize;
    const skipEmbeddings = body?.skipEmbeddings ?? false;
    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize, skipEmbeddings });
    summarizer.trigger();
    return result;
  });

  // GET /sync/status and GET /sync/gaps remain unchanged
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

- [ ] **Step 4: Verify the backend starts without errors**

```bash
npm run dev:backend
```

Then in a second terminal:

```bash
curl http://localhost:3141/summarizer/status
```

Expected: `{"status":"idle","processed":0,"pending":<N>}` where N is the number of emails currently lacking summaries.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/server.ts packages/backend/src/routes/sync.ts
git commit -m "feat(backend): wire summarizer into server and trigger after sync"
```

---

## Task 6: Terminal — poll status and show progress indicator

**Files:**
- Modify: `packages/terminal/src/api.ts`
- Modify: `packages/terminal/src/app.ts`
- Modify: `packages/terminal/src/index.ts`
- Modify: `packages/terminal/src/views/inbox.ts`

- [ ] **Step 1: Write failing test for getSummarizerStatus**

In `packages/terminal/src/api.test.ts`, add:

```typescript
it('getSummarizerStatus fetches /summarizer/status', async () => {
  fetchMock.mockResponseOnce(JSON.stringify({ status: 'running', processed: 2, pending: 3 }));
  const result = await api.getSummarizerStatus();
  expect(result.status).toBe('running');
  expect(result.processed).toBe(2);
  expect(result.pending).toBe(3);
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3141/summarizer/status',
    expect.objectContaining({ headers: expect.objectContaining({ 'Accept-Encoding': 'identity' }) })
  );
});
```

> **Note:** Check the existing `api.test.ts` to see how `fetchMock` is set up — follow the same pattern used in existing tests.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: fails with `api.getSummarizerStatus is not a function`.

- [ ] **Step 3: Add getSummarizerStatus to api.ts**

In `packages/terminal/src/api.ts`, add to the `ApiClient` interface:

```typescript
  getSummarizerStatus(): Promise<SummarizerStatus>;
```

Add the import at the top:

```typescript
import type { Email, EmailSummary, EmailListParams, SyncResult, SearchResult, SummarizerStatus } from '@gmail-sweep/shared';
```

Add the implementation inside `createApiClient`:

```typescript
    getSummarizerStatus() {
      return request<SummarizerStatus>(`${base}/summarizer/status`, {});
    },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write failing test for summarizerStatus in AppState**

In `packages/terminal/src/app.test.ts`, add:

```typescript
import type { SummarizerStatus } from '@gmail-sweep/shared';

it('setSummarizerStatus updates summarizerStatus in state', () => {
  const state = createAppState();
  expect(state.summarizerStatus).toBeNull();
  const status: SummarizerStatus = { status: 'running', processed: 1, pending: 5 };
  const updated = setSummarizerStatus(state, status);
  expect(updated.summarizerStatus).toEqual(status);
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd packages/terminal && npx vitest run src/app.test.ts
```

Expected: fails with `setSummarizerStatus is not a function`.

- [ ] **Step 7: Update app.ts**

In `packages/terminal/src/app.ts`, add the import:

```typescript
import type { Email, SummarizerStatus } from '@gmail-sweep/shared';
```

Add `summarizerStatus` to `AppState`:

```typescript
  summarizerStatus: SummarizerStatus | null;
```

Initialise it in `createAppState()`:

```typescript
    summarizerStatus: null,
```

Add the updater function:

```typescript
export function setSummarizerStatus(s: AppState, status: SummarizerStatus): AppState {
  return { ...s, summarizerStatus: status };
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd packages/terminal && npx vitest run src/app.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Add polling to index.ts**

In `packages/terminal/src/index.ts`, add the import:

```typescript
import { ..., setSummarizerStatus } from './app.js';
```

After `await loadEmails();`, add the polling loop:

```typescript
async function pollSummarizerStatus(): Promise<void> {
  try {
    const status = await api.getSummarizerStatus();
    state = setSummarizerStatus(state, status);
    render();
  } catch {
    // backend may not be ready yet — ignore
  }
}

await pollSummarizerStatus();
setInterval(pollSummarizerStatus, 5_000);
```

- [ ] **Step 10: Show progress in inbox view**

In `packages/terminal/src/views/inbox.ts`, update `renderList` to show the summariser progress in the list pane title.

Replace the start of `renderList`:

```typescript
  function renderList(state: AppState): void {
    const s = state.summarizerStatus;
    const summaryInfo = s?.status === 'running'
      ? `  ·  Summarising: ${s.processed}/${s.pending}`
      : '';
    listPane.title = ` Inbox${summaryInfo} `;
```

> **Note:** `listPane` must remain in scope of `renderList`. Since it's already defined in the outer closure of `buildInboxView`, this access is valid.

- [ ] **Step 11: Verify end-to-end**

Start backend: `npm run dev:backend`
Start TUI: `cd packages/terminal && bun run src/index.ts`
Trigger a sync via `r` key.
Observe the list-pane title update to show `Summarising: N pending` while the worker runs, then revert to `Inbox` when done.

- [ ] **Step 12: Commit**

```bash
git add packages/terminal/src/api.ts packages/terminal/src/app.ts packages/terminal/src/index.ts packages/terminal/src/views/inbox.ts
git commit -m "feat(terminal): poll summarizer status and show progress in inbox title"
```
