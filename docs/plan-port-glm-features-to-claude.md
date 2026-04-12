# Port `glm` Features to `claude` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Gmail-API-surface, sync, and TUI features that `glm` implements but `claude` currently lacks into the `claude` worktree, adapted to claude's Node + Fastify + npm-workspace architecture.

**Architecture:** Behavior-level ports, not file copies. `glm` uses Bun + Hono with classes under `src/backend/...`; `claude` uses Fastify factory-function services under `packages/backend/src/...`. Each feature below specifies the claude-side file changes. SQLite schema migrations are additive and gated on `PRAGMA table_info` / `sqlite_master` checks so existing databases upgrade in place.

**Tech stack:** TypeScript, Fastify, `better-sqlite3`, `googleapis` (OAuth2 + Gmail REST), Vitest, OpenTUI (terminal), React + Vite (web).

**Reference worktree:** `/home/ckolbegger/src/gmail-sweep/worktrees/glm/`. Do NOT copy files — read them, understand the behavior, re-implement idiomatically in claude.

**Not in scope (already tracked separately):**
- Gap-fill correctness bug and hardcoded embedding dimension (see `docs/bug-glm-html-fallback-stub.md` and Codex review output).
- Features `glm` lacks but `claude` has (no regressions — just don't break them).

---

## Feature dependency graph

```
F1 historyId persistence ─┐
                          ├─► F2 historyId incremental sync ─► F3 auto-poller
F5 listLabels ────────────┴─► F11 label filter
F6 removed_state migration ──► F7 soft-delete archive/trash rollback
                              └► F8 mark read / unread
F16 trashEmail INBOX bug fix (independent; superseded by F7 but fixes live bug immediately)
F9 unread filter (independent, only needs F6 if unread filter should ignore soft-deleted — it should)
F10 raw message passthrough (independent)
F12 operator search parser (independent of above, integrates with existing SearchService)
F13 /status healthcheck (independent)
F14 gap fill / abandon endpoints (independent; uses existing sync_gaps table)
F15 TUI detail-panel full-width toggle (independent, terminal-only)
```

---

## File structure additions / modifications

New files under `packages/backend/src/`:

- `services/auto-poller.ts` — background sync loop.
- `services/search-parser.ts` — operator-based query parsing.
- `routes/status.ts` — `/status` healthcheck.

Modified files under `packages/backend/src/`:

- `services/db.ts` — schema migrations (`sync_state` key/value for historyId, `emails.removed_state` column, `list_removed` filter, `listEmails` label/unread filters).
- `services/gmail.ts` — new methods: `listHistory`, `listLabels`, `markRead`, `markUnread`, `getRawMessage`, and expose `_lastHistoryId` via a proper return.
- `services/sync.ts` — add `runIncrementalSync`, persist `lastHistoryId`, gate by `syncInProgress` mutex helper.
- `routes/emails.ts` — `/emails/:id/raw`, `/emails/:id/read`, `/emails/:id/unread`; soft-delete archive/delete with rollback; `?label=`, `?unread=`; filter out `removed_state IS NOT NULL`.
- `routes/sync.ts` — `POST /sync/gaps/:id/fill`, `DELETE /sync/gaps/:id`, `syncInProgress` in `/sync/status`, `POST /sync/incremental` (optional, may also be auto-chosen inside `POST /sync` when historyId present).
- `routes/labels.ts` (new) — `GET /labels`.
- `server.ts` — wire new services/routes (auto-poller, status, labels).

Shared types (`packages/shared/src/types.ts`):
- `SyncStatus` gains `syncInProgress: boolean`, `lastHistoryId: string | null`, `deleted?: number` on `SyncResult`.
- New `GmailLabel` type.
- `EmailListParams` gains `label?: string`, `unread?: boolean`.
- `Email` gains `removedState?: 'archived' | 'deleted' | null` (optional so existing web/terminal still compile).

Terminal (`packages/terminal/src/`):
- `views/email.ts` — full-width detail toggle.

Web (`packages/web/src/`):
- Optional: expose read/unread toggle UI (out of scope unless user requests).

---

## Phasing

Execute features in this order. Each phase ends with passing tests and a commit.

- **Phase A (schema + types foundation):** F6 (removed_state) `[source: both]`, F1 (historyId persistence) `[source: both]`, shared type additions.
- **Phase B (Gmail adapter surface):** F5 (listLabels) `[source: both]`, new gmail methods (`listHistory`, `markRead`, `markUnread`, `getRawMessage`).
- **Phase C (email routes):** F16 (trashEmail INBOX bug fix) `[source: codex]`, F7 (soft-delete + rollback) `[source: both]`, F8 (read/unread) `[source: both]`, F10 (raw) `[source: both]`, F9/F11 (unread + label filters) `[source: both]`.
- **Phase D (sync):** F2 (incremental) `[source: both]`, F14 (gap fill/abandon) `[source: both]`, F3 (auto-poller) `[source: both]`.
- **Phase E (search + status):** F12 (operator parser) `[source: both]`, F13 (/status) `[source: claude]`.
- **Phase F (terminal):** F15 (detail-panel toggle) `[source: both]`.
- **Phase G (nice-to-haves):** F17 Gmail API retry/backoff `[source: codex]`, F18 verbose LLM logging `[source: codex]`, F19 sync limited to `INBOX` at Gmail API `[source: codex]`, F20 periodic summarizer timer `[source: codex]`. All marked `[nice-to-have]`.

---

## Feature F1: `historyId` persistence in sync state `[source: both]`

**glm reference:** `src/backend/services/sync.ts` lines 86–92, 184–190; `src/backend/db/schema.ts` — glm uses a key/value `sync_state` table and writes `last_history_id`.

**Claude today:** `sync_state` is a single-row table with fixed columns (`newest_date`, `oldest_date`, `total_synced`, `last_sync_at`). No `last_history_id`.

**Approach:** Add a `last_history_id TEXT NULL` column to the single-row `sync_state` table (simpler than changing to key/value). Expose through `DbHandle.getSyncState()` and a new `DbHandle.setLastHistoryId(id: string | null)`.

**Files:**
- Modify: `packages/backend/src/services/db.ts`
- Modify: `packages/backend/src/services/db.test.ts`
- Modify: `packages/shared/src/types.ts` (add `lastHistoryId` to `SyncStatus`)

- [ ] **Step 1: Write failing test**

In `packages/backend/src/services/db.test.ts`, add:

```ts
it('persists and reads lastHistoryId', () => {
  const db = createDb(':memory:');
  expect(db.getSyncState().lastHistoryId).toBeNull();
  db.setLastHistoryId('12345');
  expect(db.getSyncState().lastHistoryId).toBe('12345');
  db.setLastHistoryId(null);
  expect(db.getSyncState().lastHistoryId).toBeNull();
  db.close();
});
```

- [ ] **Step 2: Run and verify fail**

```
cd packages/backend && npx vitest run src/services/db.test.ts -t lastHistoryId
```

Expected: FAIL — `db.setLastHistoryId is not a function`.

- [ ] **Step 3: Implement**

In `packages/backend/src/services/db.ts`:

1. Extend `DbHandle` interface:
```ts
setLastHistoryId(id: string | null): void;
```
2. Extend `getSyncState()` return to include `lastHistoryId: string | null`.
3. In `applySchema`, add migration:
```ts
const syncCols = (db.prepare("PRAGMA table_info(sync_state)").all() as Array<{ name: string }>).map(c => c.name);
if (!syncCols.includes('last_history_id')) {
  db.exec('ALTER TABLE sync_state ADD COLUMN last_history_id TEXT');
}
```
4. Update `getSyncState()`:
```ts
return {
  totalSynced: (row?.total_synced as number) ?? 0,
  newestDate: (row?.newest_date as string) ?? null,
  oldestDate: (row?.oldest_date as string) ?? null,
  lastHistoryId: (row?.last_history_id as string) ?? null,
};
```
5. Add:
```ts
setLastHistoryId(id) {
  db.prepare('UPDATE sync_state SET last_history_id = ? WHERE id = 1').run(id);
},
```

In `packages/shared/src/types.ts`:
```ts
export interface SyncStatus {
  totalSynced: number;
  newestDate: string | null;
  oldestDate: string | null;
  lastHistoryId: string | null;
  hasGaps: boolean;
  gaps: Gap[];
}
```

- [ ] **Step 4: Verify pass**

```
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: PASS. Also run `packages/shared` build to check type integrity.

- [ ] **Step 5: Commit**

```
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts packages/shared/src/types.ts
git commit -m "feat(db): persist lastHistoryId in sync_state"
```

---

## Feature F2: `historyId`-based incremental sync `[source: both]`

**glm reference:** `src/backend/services/sync.ts` `syncIncremental()` lines 120–193; `src/backend/gmail/gmail-api.ts` `listHistory()` lines 174–207.

**Behavior:** After a full newest-first sync writes `lastHistoryId`, subsequent sync calls can use `users.history.list` to only fetch added/deleted message IDs since that history cursor. On a 404 (history expired), fall back to full newest-first sync. `messagesAdded` → fetch message body → upsert. `messagesDeleted` → remove local row.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts` — add `listHistory` and capture `historyId` from `users.messages.list`/`users.messages.get` responses.
- Modify: `packages/backend/src/services/sync.ts` — add `runIncrementalSync`; update `runSyncCycle` to capture and persist `historyId`.
- Modify: `packages/backend/src/services/sync.test.ts`
- Modify: `packages/shared/src/types.ts` — `SyncResult` gains `deleted?: number`, `mode: 'full' | 'incremental'`.

- [ ] **Step 1: Write failing unit test for `listHistory` adapter surface**

In `packages/backend/src/services/sync.test.ts` add a test using a mocked `GmailService` that exposes `listHistory`:

```ts
it('runIncrementalSync applies messagesAdded and messagesDeleted', async () => {
  const db = createDb(':memory:');
  db.upsertEmail({ id: 'old', threadId: 't', subject: 's', from: 'a', date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null, labels: ['INBOX'], summary: null });
  db.setLastHistoryId('100');

  const gmail = {
    listHistory: vi.fn().mockResolvedValue({
      history: [
        { id: '101', messagesAdded: [{ id: 'new1' }], messagesDeleted: [] },
        { id: '102', messagesAdded: [], messagesDeleted: [{ id: 'old' }] },
      ],
      historyId: '102',
    }),
    fetchMessagesById: vi.fn().mockResolvedValue({
      id: 'new1', threadId: 'tn', subject: 'hi', from: 'b', date: '2025-02-01T00:00:00Z',
      snippet: '', bodyText: '', bodyHtml: null, labels: ['INBOX'], summary: null,
    }),
  } as unknown as GmailService;

  const result = await runIncrementalSync(db, gmail);
  expect(result.newEmails).toBe(1);
  expect(result.deleted).toBe(1);
  expect(db.getEmail('old')).toBeNull();
  expect(db.getEmail('new1')).not.toBeNull();
  expect(db.getSyncState().lastHistoryId).toBe('102');
  db.close();
});
```

- [ ] **Step 2: Run and verify fail**

```
cd packages/backend && npx vitest run src/services/sync.test.ts -t runIncrementalSync
```

Expected: FAIL — `runIncrementalSync is not defined`.

- [ ] **Step 3: Implement gmail adapter additions**

In `packages/backend/src/services/gmail.ts`, extend `GmailService` interface:

```ts
listHistory(startHistoryId: string): Promise<{
  history: Array<{
    id: string;
    messagesAdded?: Array<{ id: string; threadId: string }>;
    messagesDeleted?: Array<{ id: string; threadId: string }>;
  }>;
  historyId: string;
  expired?: boolean;
}>;
fetchMessagesById(id: string): Promise<Email | null>;
```

Implementation:

```ts
async listHistory(startHistoryId) {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  try {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded', 'messageDeleted'],
    });
    const records = (res.data.history ?? []).map(h => ({
      id: String(h.id),
      messagesAdded: (h.messagesAdded ?? []).map(m => ({ id: m.message!.id!, threadId: m.message!.threadId! })),
      messagesDeleted: (h.messagesDeleted ?? []).map(m => ({ id: m.message!.id!, threadId: m.message!.threadId! })),
    }));
    return { history: records, historyId: String(res.data.historyId ?? startHistoryId) };
  } catch (err: any) {
    if (err?.code === 404) return { history: [], historyId: startHistoryId, expired: true };
    throw err;
  }
},

async fetchMessagesById(id) {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  try {
    const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return messageToEmail(detail.data as GmailMessage);
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
},
```

Also: in `fetchMessagesSince`, capture `res.data.historyId` (from the list response — Gmail returns `historyId` on list) and store to a mutable field on the service for sync to persist. Simpler: have `fetchMessagesSince` return `{ emails, historyId }` instead. Update its callers in `sync.ts`.

Update the return type:
```ts
fetchMessagesSince(date: string | null, maxResults: number): Promise<{ emails: Email[]; historyId: string | null }>;
```

- [ ] **Step 4: Implement `runIncrementalSync` in `sync.ts`**

```ts
export async function runIncrementalSync(
  db: DbHandle,
  gmail: GmailService
): Promise<SyncResult & { deleted: number; mode: 'incremental' | 'full' }> {
  const { lastHistoryId } = db.getSyncState();
  if (!lastHistoryId) {
    // fall through — caller should run full sync
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
      // Use soft delete so later F7 rollback path is consistent; but here it's a Gmail-side delete, so mark removed.
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
```

Note: `db.markEmailRemoved` is introduced in F6 (removed_state). Order feature F6 BEFORE F2, or temporarily use `db.deleteGap`-style hard delete and revisit. Since phasing is A→B→C→D, F6 lands in Phase A before F2 (Phase D). Good.

Also modify `runSyncCycle` to persist `historyId` from `fetchMessagesSince`:

```ts
const { emails: fetched, historyId: newHistoryId } = await gmail.fetchMessagesSince(state.newestDate, remaining);
// ... after upserts:
if (newHistoryId) db.setLastHistoryId(newHistoryId);
```

- [ ] **Step 5: Verify tests pass**

```
cd packages/backend && npx vitest run src/services/sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add packages/backend/src/services/gmail.ts packages/backend/src/services/sync.ts packages/backend/src/services/sync.test.ts packages/shared/src/types.ts
git commit -m "feat(sync): historyId-based incremental sync with expiry fallback"
```

---

## Feature F3: Auto-poller (background periodic sync) `[source: both]`

**glm reference:** `src/backend/services/auto-poller.ts` — `setInterval` with re-entrancy guard + `isAuthorized` check.

**Files:**
- Create: `packages/backend/src/services/auto-poller.ts`
- Create: `packages/backend/src/services/auto-poller.test.ts`
- Modify: `packages/backend/src/server.ts` — start the poller if `config.sync.autoPollIntervalMs > 0`.
- Modify: `packages/shared/src/types.ts` — `AppConfig.sync.autoPollIntervalMs?: number`.

- [ ] **Step 1: Write failing test**

```ts
// packages/backend/src/services/auto-poller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAutoPoller } from './auto-poller.js';

describe('auto-poller', () => {
  it('skips when not authorized', async () => {
    vi.useFakeTimers();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const poller = createAutoPoller({ intervalMs: 1000, isAuthorized: () => false, onSync });
    poller.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onSync).not.toHaveBeenCalled();
    poller.stop();
    vi.useRealTimers();
  });

  it('invokes onSync on interval and prevents re-entry', async () => {
    vi.useFakeTimers();
    let resolveSync: () => void;
    const onSync = vi.fn().mockImplementation(() => new Promise<void>(r => { resolveSync = r; }));
    const poller = createAutoPoller({ intervalMs: 1000, isAuthorized: () => true, onSync });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(1); // still running
    resolveSync!();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(2);
    poller.stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run and verify fail**

```
cd packages/backend && npx vitest run src/services/auto-poller.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/backend/src/services/auto-poller.ts
export interface AutoPollerOptions {
  intervalMs: number;
  isAuthorized: () => boolean | Promise<boolean>;
  onSync: () => Promise<void>;
  logger?: { error: (msg: string, err?: unknown) => void };
}

export interface AutoPoller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createAutoPoller(opts: AutoPollerOptions): AutoPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let syncing = false;

  return {
    start() {
      if (opts.intervalMs <= 0 || timer) return;
      timer = setInterval(async () => {
        if (syncing) return;
        if (!(await opts.isAuthorized())) return;
        syncing = true;
        try { await opts.onSync(); }
        catch (err) { opts.logger?.error('[auto-poller] sync failed', err); }
        finally { syncing = false; }
      }, opts.intervalMs);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    isRunning() { return timer !== null; },
  };
}
```

- [ ] **Step 4: Wire into server.ts**

```ts
import { createAutoPoller } from './services/auto-poller.js';
// ...
const poller = createAutoPoller({
  intervalMs: config.sync.autoPollIntervalMs ?? 0,
  isAuthorized: () => gmail.isAuthenticated(),
  onSync: async () => {
    await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: config.sync.defaultBatchSize });
    summarizer.trigger();
  },
  logger: app.log,
});
poller.start();
app.addHook('onClose', async () => poller.stop());
```

Add `autoPollIntervalMs?: number` to `AppConfig.sync` in `packages/shared/src/types.ts`.

- [ ] **Step 5: Verify pass**

```
cd packages/backend && npx vitest run src/services/auto-poller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add packages/backend/src/services/auto-poller.ts packages/backend/src/services/auto-poller.test.ts packages/backend/src/server.ts packages/shared/src/types.ts
git commit -m "feat(backend): auto-poller for periodic background sync"
```

---

## Feature F4: `syncInProgress` mutex exposed in `/sync/status` `[SKIPPED — see Skipped items at end]`

> Skipped per user direction: claude already has equivalent behavior in a different shape (synchronous `/sync` that returns detailed counts rather than glm's 202 + in-memory mutex). Retained here for context; not in execution order. See "Skipped items" section at the end of the document.

Original F4 content below (do not execute):

**glm reference:** `src/backend/routes/sync.ts` — module-level `let syncInProgress` flag, set around `syncService.syncNewest`, surfaced in `/sync/status`.

**Files:**
- Modify: `packages/backend/src/routes/sync.ts`
- Modify: `packages/backend/src/routes/sync.test.ts`
- Modify: `packages/shared/src/types.ts` — `SyncStatus.syncInProgress: boolean`.

**Approach:** Move the flag to a per-server shared state held in a module-level object or Fastify decorator. Simpler: create a `createSyncMutex()` factory used in `server.ts` and passed to the route.

- [ ] **Step 1: Write failing test**

In `packages/backend/src/routes/sync.test.ts`:

```ts
it('returns syncInProgress=false initially and rejects concurrent /sync with 409', async () => {
  const app = await buildTestServer();
  const status = await app.inject({ method: 'GET', url: '/sync/status' });
  expect(status.json().syncInProgress).toBe(false);

  // Start a slow sync
  const slow = app.inject({ method: 'POST', url: '/sync' }); // mock gmail to hang
  const racing = await app.inject({ method: 'POST', url: '/sync' });
  expect(racing.statusCode).toBe(409);
  await slow;
});
```

- [ ] **Step 2: Run and verify fail**

```
cd packages/backend && npx vitest run src/routes/sync.test.ts -t syncInProgress
```

Expected: FAIL.

- [ ] **Step 3: Implement**

In `packages/backend/src/routes/sync.ts`, capture flag in closure:

```ts
export async function syncRoutes(app, options) {
  const { db, gmail, embed, config, defaultBatchSize, summarizer } = options;
  let syncInProgress = false;

  app.post('/sync', async (request, reply) => {
    if (syncInProgress) return reply.code(409).send({ error: 'Sync already in progress' });
    syncInProgress = true;
    try {
      const body = request.body as { batchSize?: number; skipEmbeddings?: boolean } | undefined;
      const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: body?.batchSize ?? defaultBatchSize, skipEmbeddings: body?.skipEmbeddings ?? false });
      summarizer.trigger();
      return result;
    } finally {
      syncInProgress = false;
    }
  });

  app.get('/sync/status', async () => {
    const state = db.getSyncState();
    const gaps = db.listGaps();
    return { ...state, gaps, hasGaps: gaps.length > 0, syncInProgress };
  });
}
```

Add to `SyncStatus` in shared types: `syncInProgress: boolean`.

- [ ] **Step 4: Verify pass, then commit**

```
cd packages/backend && npx vitest run src/routes/sync.test.ts
git add packages/backend/src/routes/sync.ts packages/backend/src/routes/sync.test.ts packages/shared/src/types.ts
git commit -m "feat(sync): expose syncInProgress mutex in /sync/status"
```

---

## Feature F5: `listLabels` adapter method + `GET /labels` route `[source: both]`

**glm reference:** `src/backend/gmail/gmail-api.ts` `listLabels()` lines 168–172.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts` — add `listLabels()`.
- Create: `packages/backend/src/routes/labels.ts`
- Create: `packages/backend/src/routes/labels.test.ts`
- Modify: `packages/backend/src/server.ts` — register route.
- Modify: `packages/shared/src/types.ts` — add `GmailLabel`.

- [ ] **Step 1: Write failing test**

```ts
// packages/backend/src/routes/labels.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { labelsRoutes } from './labels.js';

describe('GET /labels', () => {
  it('returns labels from gmail service', async () => {
    const app = Fastify();
    const gmail = { listLabels: async () => [{ id: 'INBOX', name: 'INBOX' }, { id: 'Label_1', name: 'Work' }] } as any;
    await app.register(labelsRoutes, { gmail });
    const res = await app.inject({ method: 'GET', url: '/labels' });
    expect(res.statusCode).toBe(200);
    expect(res.json().labels).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Verify fail**

```
cd packages/backend && npx vitest run src/routes/labels.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/types.ts
export interface GmailLabel { id: string; name: string; }
```

```ts
// packages/backend/src/services/gmail.ts — add to interface and impl
listLabels(): Promise<GmailLabel[]>;

// impl:
async listLabels() {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const res = await gmail.users.labels.list({ userId: 'me' });
  return (res.data.labels ?? []).map(l => ({ id: l.id!, name: l.name! }));
},
```

```ts
// packages/backend/src/routes/labels.ts
import type { FastifyInstance } from 'fastify';
import type { GmailService } from '../services/gmail.js';

export async function labelsRoutes(app: FastifyInstance, options: { gmail: GmailService }) {
  app.get('/labels', async () => {
    const labels = await options.gmail.listLabels();
    return { labels };
  });
}
```

In `server.ts`:
```ts
import { labelsRoutes } from './routes/labels.js';
await app.register(labelsRoutes, { gmail });
```

- [ ] **Step 4: Verify pass and commit**

```
cd packages/backend && npx vitest run src/routes/labels.test.ts
git add packages/backend/src/routes/labels.ts packages/backend/src/routes/labels.test.ts packages/backend/src/services/gmail.ts packages/backend/src/server.ts packages/shared/src/types.ts
git commit -m "feat(gmail): list labels adapter and GET /labels route"
```

---

## Feature F6: `removed_state` column (soft-delete schema) `[source: both]`

**glm reference:** `src/backend/db/schema.ts` — `emails.removed_state TEXT NULL`, queries filter `WHERE removed_state IS NULL`.

**Files:**
- Modify: `packages/backend/src/services/db.ts` — migration, new methods `markEmailRemoved(id, state)`, `clearEmailRemoved(id)`; filter `removed_state IS NULL` in `listEmails`, `getEmailsWithoutEmbedding`, `getNextEmailWithoutSummary`, `countEmailsWithoutSummary`.
- Modify: `packages/backend/src/services/db.test.ts`
- Modify: `packages/shared/src/types.ts` — `Email.removedState?: 'archived' | 'deleted' | null`.

- [ ] **Step 1: Write failing test**

```ts
it('markEmailRemoved hides email from listEmails until cleared', () => {
  const db = createDb(':memory:');
  db.upsertEmail({ id: 'a', threadId: 't', subject: 's', from: 'x', date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null, labels: ['INBOX'], summary: null });
  expect(db.listEmails({}).length).toBe(1);
  db.markEmailRemoved('a', 'archived');
  expect(db.listEmails({}).length).toBe(0);
  db.clearEmailRemoved('a');
  expect(db.listEmails({}).length).toBe(1);
  db.close();
});
```

- [ ] **Step 2: Verify fail**

```
cd packages/backend && npx vitest run src/services/db.test.ts -t removed_state
```

Expected: FAIL.

- [ ] **Step 3: Implement**

In `applySchema`:
```ts
const emailsCols2 = (db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>).map(c => c.name);
if (!emailsCols2.includes('removed_state')) {
  db.exec("ALTER TABLE emails ADD COLUMN removed_state TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_emails_removed ON emails(removed_state)");
}
```

Add to `DbHandle`:
```ts
markEmailRemoved(id: string, state: 'archived' | 'deleted'): void;
clearEmailRemoved(id: string): void;
```

Implementations:
```ts
markEmailRemoved(id, state) {
  db.prepare('UPDATE emails SET removed_state = ? WHERE id = ?').run(state, id);
},
clearEmailRemoved(id) {
  db.prepare('UPDATE emails SET removed_state = NULL WHERE id = ?').run(id);
},
```

In `listEmails`, prepend `"removed_state IS NULL"` to conditions. Same in `getEmailsWithoutEmbedding` and `getNextEmailWithoutSummary`/`countEmailsWithoutSummary`.

Update `rowToEmail` to include `removedState: (row.removed_state as 'archived'|'deleted'|null) ?? null`.

Shared types: `Email.removedState?: 'archived' | 'deleted' | null`.

- [ ] **Step 4: Verify pass and commit**

```
cd packages/backend && npx vitest run src/services/db.test.ts
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts packages/shared/src/types.ts
git commit -m "feat(db): add removed_state soft-delete column"
```

---

## Feature F7: Soft-delete archive/trash with rollback on Gmail API failure `[source: both]`

**glm reference:** `src/backend/routes/emails.ts` lines 105–139. Pattern: set `removed_state`, fire Gmail API, on failure revert `removed_state = NULL`.

**Files:**
- Modify: `packages/backend/src/routes/emails.ts`
- Modify: `packages/backend/src/routes/emails.test.ts`

**Design note:** claude currently awaits the Gmail API call before updating local state. The glm pattern inverts: local-first optimistic update, fire-and-forget API, rollback on failure. Prefer **sync-with-rollback**: mark removed, `await gmail.archive(id)`, on throw revert and return 502. This preserves the soft-delete guarantee but fails loudly so the caller sees the error. Document the deviation from glm's fire-and-forget.

- [ ] **Step 1: Write failing test**

```ts
it('archive rolls back removed_state when Gmail API throws', async () => {
  const app = await buildTestServer({
    gmail: { archiveMessage: vi.fn().mockRejectedValue(new Error('boom')) },
  });
  // seed an email
  const res = await app.inject({ method: 'POST', url: '/emails/abc/archive' });
  expect(res.statusCode).toBe(502);
  expect(db.getEmail('abc')?.removedState).toBeNull();
});

it('archive sets removed_state=archived on success and hides from list', async () => {
  // ...
  const list = await app.inject({ method: 'GET', url: '/emails' });
  expect(list.json().emails.find((e: any) => e.id === 'abc')).toBeUndefined();
});
```

- [ ] **Step 2: Verify fail**

```
cd packages/backend && npx vitest run src/routes/emails.test.ts -t rolls back
```

- [ ] **Step 3: Implement**

Replace archive/delete handlers in `routes/emails.ts`:

```ts
app.post('/emails/:id/archive', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
  db.markEmailRemoved(id, 'archived');
  try {
    await gmail.archiveMessage(id);
  } catch (err) {
    db.clearEmailRemoved(id);
    request.log.error({ err }, 'gmail archive failed, rolled back');
    return reply.code(502).send({ error: 'Gmail API error' });
  }
  return { ok: true };
});

app.post('/emails/:id/delete', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
  db.markEmailRemoved(id, 'deleted');
  try {
    await gmail.deleteMessage(id);
  } catch (err) {
    db.clearEmailRemoved(id);
    request.log.error({ err }, 'gmail delete failed, rolled back');
    return reply.code(502).send({ error: 'Gmail API error' });
  }
  return { ok: true };
});
```

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/routes/emails.test.ts
git add packages/backend/src/routes/emails.ts packages/backend/src/routes/emails.test.ts
git commit -m "feat(emails): soft-delete archive/trash with rollback on Gmail failure"
```

---

## Feature F8: Mark read / mark unread endpoints `[source: both]`

**glm reference:** `src/backend/routes/emails.ts` lines 141–173; uses `modifyLabels(id, { addLabelIds: ['UNREAD'], removeLabelIds: [] })`.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts` — add `markRead(id)`, `markUnread(id)`.
- Modify: `packages/backend/src/services/db.ts` — need `is_read` state. Claude stores labels as a JSON array; `UNREAD` label presence encodes unread. Add helper `setReadState(id, read: boolean)` that mutates the labels array.
- Modify: `packages/backend/src/routes/emails.ts` — new routes.
- Modify: `packages/backend/src/routes/emails.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('POST /emails/:id/read removes UNREAD label and calls gmail.markRead', async () => {
  // seed with labels ['INBOX', 'UNREAD']
  const res = await app.inject({ method: 'POST', url: '/emails/abc/read' });
  expect(res.statusCode).toBe(200);
  expect(db.getEmail('abc')!.labels).not.toContain('UNREAD');
  expect(gmailMock.markRead).toHaveBeenCalledWith('abc');
});

it('POST /emails/:id/unread adds UNREAD label', async () => { /* mirror */ });

it('returns 502 and does not persist local change when gmail throws', async () => { /* rollback */ });
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

`services/gmail.ts`:
```ts
markRead(id: string): Promise<void>;
markUnread(id: string): Promise<void>;

// impl:
async markRead(id) {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  await gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } });
},
async markUnread(id) {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: ['UNREAD'] } });
},
```

`services/db.ts` — add:
```ts
setReadState(id: string, read: boolean): void;

// impl:
setReadState(id, read) {
  const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
  if (!row) return;
  const labels = JSON.parse(row.labels) as string[];
  const filtered = labels.filter(l => l !== 'UNREAD');
  if (!read) filtered.push('UNREAD');
  db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(filtered), id);
},
```

`routes/emails.ts`:
```ts
app.post('/emails/:id/read', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
  try { await gmail.markRead(id); }
  catch (err) { request.log.error({ err }, 'gmail markRead failed'); return reply.code(502).send({ error: 'Gmail API error' }); }
  db.setReadState(id, true);
  return { ok: true };
});
// ... mirror for /unread with gmail.markUnread and db.setReadState(id, false)
```

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/routes/emails.test.ts
git add packages/backend/src/routes/emails.ts packages/backend/src/routes/emails.test.ts packages/backend/src/services/gmail.ts packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts
git commit -m "feat(emails): mark read/unread endpoints"
```

---

## Feature F9: Unread filter on `GET /emails` (`?unread=true|false`) `[source: both]`

**glm reference:** `src/backend/routes/emails.ts` lines 12–22.

**Claude approach:** Labels are stored as JSON array; presence of `UNREAD` in labels → unread. Use `labels LIKE '%UNREAD%'` (safe since label IDs are well-formed).

**Files:**
- Modify: `packages/backend/src/services/db.ts` — add `unread?: boolean` to `listEmails` params.
- Modify: `packages/shared/src/types.ts` — `EmailListParams.unread?: boolean`.
- Modify: `packages/backend/src/routes/emails.ts` — parse query param.
- Modify: `packages/backend/src/services/db.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('listEmails filters by unread label presence', () => {
  const db = createDb(':memory:');
  db.upsertEmail({ id: 'u', /* ... */ labels: ['INBOX', 'UNREAD'], /* ... */ });
  db.upsertEmail({ id: 'r', /* ... */ labels: ['INBOX'], /* ... */ });
  expect(db.listEmails({ unread: true }).map(e => e.id)).toEqual(['u']);
  expect(db.listEmails({ unread: false }).map(e => e.id)).toEqual(['r']);
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

In `listEmails`:
```ts
if (params.unread === true)  conditions.push("labels LIKE '%\"UNREAD\"%'");
if (params.unread === false) conditions.push("labels NOT LIKE '%\"UNREAD\"%'");
```

In route, parse `unread` query string (`'true' | 'false'`) into boolean and pass through.

- [ ] **Step 4: Verify and commit**

```
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts packages/backend/src/routes/emails.ts packages/shared/src/types.ts
git commit -m "feat(emails): unread filter on GET /emails"
```

---

## Feature F10: Raw Gmail message passthrough (`GET /emails/:id/raw`) `[source: both]`

**glm reference:** `src/backend/routes/emails.ts` lines 93–103 — returns the adapter's `getMessage(id)` as JSON.

**Claude approach:** Add `getRawMessage(id)` to `GmailService` that returns the raw Gmail API response (not the `Email` projection). Route returns it as JSON.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts` — add `getRawMessage(id): Promise<unknown | null>`.
- Modify: `packages/backend/src/routes/emails.ts` — add route.
- Modify: `packages/backend/src/routes/emails.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('GET /emails/:id/raw returns raw gmail response', async () => {
  const fake = { id: 'abc', payload: { headers: [] }, labelIds: ['INBOX'] };
  const app = await buildTestServer({ gmail: { getRawMessage: async () => fake } });
  const res = await app.inject({ method: 'GET', url: '/emails/abc/raw' });
  expect(res.json()).toEqual(fake);
});

it('returns 404 when gmail returns null', async () => { /* ... */ });
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

```ts
// services/gmail.ts
async getRawMessage(id) {
  await loadTokens();
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  try {
    const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return detail.data;
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
},
```

```ts
// routes/emails.ts
app.get('/emails/:id/raw', async (request, reply) => {
  const { id } = request.params as { id: string };
  const raw = await gmail.getRawMessage(id);
  if (!raw) return reply.code(404).send({ error: 'Message not found in Gmail' });
  return raw;
});
```

- [ ] **Step 4: Verify and commit**

```
git add packages/backend/src/routes/emails.ts packages/backend/src/routes/emails.test.ts packages/backend/src/services/gmail.ts
git commit -m "feat(emails): raw gmail message passthrough endpoint"
```

---

## Feature F11: Label-name filter on `GET /emails` (`?label=`) `[source: both]`

**glm reference:** `src/backend/routes/emails.ts` lines 24–28 using `json_each(labels)`. glm stores labels as objects with `{id, name}` — hence `json_extract`. Claude stores labels as a flat string array. So claude just needs `labels LIKE '%"LabelName"%'` (JSON-encoded check, safer than plain LIKE because of surrounding quotes).

**Files:**
- Modify: `packages/backend/src/services/db.ts` — add `label?: string` to `listEmails`.
- Modify: `packages/backend/src/services/db.test.ts`
- Modify: `packages/shared/src/types.ts` — `EmailListParams.label?: string`.
- Modify: `packages/backend/src/routes/emails.ts` — parse query.

- [ ] **Step 1: Failing test**

```ts
it('listEmails filters by label id', () => {
  db.upsertEmail({ id: '1', /* ... */ labels: ['INBOX', 'Label_1'] });
  db.upsertEmail({ id: '2', /* ... */ labels: ['INBOX'] });
  expect(db.listEmails({ label: 'Label_1' }).map(e => e.id)).toEqual(['1']);
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

```ts
if (params.label) {
  conditions.push("labels LIKE ?");
  bindings.push(`%"${params.label}"%`);
}
```

Route:
```ts
const label = (request.query as any).label as string | undefined;
// pass to db.listEmails({ label, ... })
```

- [ ] **Step 4: Verify and commit**

```
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts packages/backend/src/routes/emails.ts packages/shared/src/types.ts
git commit -m "feat(emails): label filter on GET /emails"
```

---

## Feature F12: Operator-based search parser `[source: both]`

**glm reference:** `src/backend/services/search-parser.ts` — parses `from:`, `to:`, `subject:`, `before:`, `after:`, `label:`, `is:read|unread|starred`, `has:actions|no-actions`.

**Design decision: how operator parsing interacts with claude's LLM-parsed search.**

Claude's `SearchService.search` currently calls `ai.parseSearchQuery(query)` unconditionally. Plan:

1. Run the operator parser FIRST on the raw query.
2. If any operators are found (`Object.keys(operators).length > 0`), skip the LLM parse and use the operators directly as `filters`. The remaining `freeText` becomes `semanticQuery`.
3. If no operators are found, keep current behavior (LLM parse).

This gives users deterministic control when they care, and leaves the LLM path for free-form queries. Operators also handle `has:actions` / `is:starred` which the LLM path does not.

**Files:**
- Create: `packages/backend/src/services/search-parser.ts`
- Create: `packages/backend/src/services/search-parser.test.ts`
- Modify: `packages/backend/src/services/search.ts` — gate LLM call on operator absence.
- Modify: `packages/backend/src/services/db.ts` — `listEmails` needs to support `starred`, and `has_actions` filters (see below).
- Modify: `packages/shared/src/types.ts` — extend `EmailListParams` with `starred?: boolean; hasActions?: boolean`.

Note: `has:actions` requires knowing if an email has action items. Claude stores `summary` as a JSON blob with `actionItems: string[]`. Add a JSON1-based filter:
```sql
json_array_length(json_extract(summary, '$.actionItems')) > 0
```

- [ ] **Step 1: Write failing test for parser**

```ts
// packages/backend/src/services/search-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseOperatorQuery } from './search-parser.js';

describe('parseOperatorQuery', () => {
  it('extracts from: and subject:', () => {
    const q = parseOperatorQuery('from:alice subject:invoice please pay');
    expect(q.operators).toEqual({ from: 'alice', subject: 'invoice' });
    expect(q.freeText).toBe('please pay');
  });

  it('returns empty operators for free-text-only', () => {
    const q = parseOperatorQuery('quarterly report');
    expect(q.operators).toEqual({});
    expect(q.freeText).toBe('quarterly report');
  });

  it('parses is: and has:', () => {
    const q = parseOperatorQuery('is:unread has:actions');
    expect(q.operators).toEqual({ is: 'unread', has: 'actions' });
  });

  it('parses before: and after: as ISO dates', () => {
    const q = parseOperatorQuery('before:2025-01-01 after:2024-06-01');
    expect(q.operators).toEqual({ before: '2025-01-01', after: '2024-06-01' });
  });
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement parser**

```ts
// packages/backend/src/services/search-parser.ts
export interface ParsedOperatorQuery {
  operators: {
    from?: string;
    to?: string;
    subject?: string;
    before?: string;
    after?: string;
    label?: string;
    is?: 'read' | 'unread' | 'starred';
    has?: 'actions' | 'no-actions';
  };
  freeText: string;
}

const KEYS = new Set(['from', 'to', 'subject', 'before', 'after', 'label', 'is', 'has']);

export function parseOperatorQuery(query: string): ParsedOperatorQuery {
  const operators: ParsedOperatorQuery['operators'] = {};
  const freeTextTokens: string[] = [];
  if (!query.trim()) return { operators, freeText: '' };

  for (const token of query.split(/\s+/)) {
    const idx = token.indexOf(':');
    if (idx > 0) {
      const k = token.substring(0, idx);
      const v = token.substring(idx + 1);
      if (KEYS.has(k) && v) {
        (operators as any)[k] = v;
        continue;
      }
    }
    freeTextTokens.push(token);
  }
  return { operators, freeText: freeTextTokens.join(' ') };
}
```

- [ ] **Step 4: Integration test in search.test.ts**

```ts
it('uses operator parser instead of LLM when operators present', async () => {
  const aiMock = { parseSearchQuery: vi.fn() };
  const search = createSearchService(db, aiMock as any, embedMock);
  db.upsertEmail({ id: '1', /* ... */ from: 'alice@example.com', subject: 'invoice', /* ... */ });
  db.upsertEmail({ id: '2', /* ... */ from: 'bob@example.com', subject: 'hello', /* ... */ });
  const res = await search.search({ query: 'from:alice' });
  expect(aiMock.parseSearchQuery).not.toHaveBeenCalled();
  expect(res.emails.map(e => e.id)).toContain('1');
});
```

- [ ] **Step 5: Wire into SearchService**

In `services/search.ts`, at the top of `search()`:

```ts
import { parseOperatorQuery } from './search-parser.js';
// ...
const opQuery = parseOperatorQuery(query);
const hasOperators = Object.keys(opQuery.operators).length > 0;

let parsed;
if (hasOperators) {
  parsed = {
    filters: {
      sender: opQuery.operators.from,
      subject: opQuery.operators.subject,
      date_from: opQuery.operators.after,
      date_to: opQuery.operators.before,
      label: opQuery.operators.label,
      unread: opQuery.operators.is === 'unread' ? true : opQuery.operators.is === 'read' ? false : undefined,
      starred: opQuery.operators.is === 'starred' ? true : undefined,
      hasActions: opQuery.operators.has === 'actions' ? true : opQuery.operators.has === 'no-actions' ? false : undefined,
    },
    semanticQuery: opQuery.freeText,
  };
} else {
  parsed = await ai.parseSearchQuery(query);
  // ensure shape matches (back-compat)
}
```

Add corresponding filter support to `db.listEmails`:

```ts
if (params.starred === true)  conditions.push("labels LIKE '%\"STARRED\"%'");
if (params.hasActions === true)  conditions.push("summary IS NOT NULL AND json_array_length(json_extract(summary, '$.actionItems')) > 0");
if (params.hasActions === false) conditions.push("(summary IS NULL OR json_array_length(json_extract(summary, '$.actionItems')) = 0)");
```

Extend `EmailListParams` in shared types accordingly.

- [ ] **Step 6: Verify all tests, commit**

```
cd packages/backend && npx vitest run src/services/search-parser.test.ts src/services/search.test.ts src/services/db.test.ts
git add packages/backend/src/services/search-parser.ts packages/backend/src/services/search-parser.test.ts packages/backend/src/services/search.ts packages/backend/src/services/search.test.ts packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts packages/shared/src/types.ts
git commit -m "feat(search): operator-based query parser complementing LLM search"
```

---

## Feature F13: `/status` healthcheck with DB probe `[source: claude]`

> Note: codex comparison observes that claude already exposes `GET /health`. This feature adds a richer `/status` endpoint with a DB probe and version info. If the implementing agent judges the existing `/health` sufficient, this feature may be downgraded to nice-to-have.

**glm reference:** `src/backend/routes/status.ts`.

**Files:**
- Create: `packages/backend/src/routes/status.ts`
- Create: `packages/backend/src/routes/status.test.ts`
- Modify: `packages/backend/src/services/db.ts` — add `ping(): boolean`.
- Modify: `packages/backend/src/server.ts` — register. (Note: `/health` already exists; add `/status` as a richer variant.)

- [ ] **Step 1: Failing test**

```ts
it('GET /status returns ok with database=connected', async () => {
  const app = await buildTestServer();
  const res = await app.inject({ method: 'GET', url: '/status' });
  expect(res.json()).toMatchObject({ status: 'ok', database: 'connected' });
  expect(res.json().version).toBeDefined();
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

```ts
// services/db.ts add:
ping(): boolean;

// impl:
ping() {
  try { db.prepare('SELECT 1').get(); return true; } catch { return false; }
},
```

```ts
// routes/status.ts
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8'));

export async function statusRoutes(app: FastifyInstance, opts: { db: DbHandle }) {
  app.get('/status', async () => ({
    status: 'ok',
    version: pkg.version,
    database: opts.db.ping() ? 'connected' : 'error',
  }));
}
```

In `server.ts`:
```ts
import { statusRoutes } from './routes/status.js';
await app.register(statusRoutes, { db });
```

- [ ] **Step 4: Verify and commit**

```
git add packages/backend/src/routes/status.ts packages/backend/src/routes/status.test.ts packages/backend/src/services/db.ts packages/backend/src/server.ts
git commit -m "feat(backend): /status healthcheck with db probe"
```

---

## Feature F14: Manual gap fill / abandon endpoints `[source: both]`

**glm reference:** `src/backend/routes/sync.ts` lines 59–85 and `src/backend/services/gap-manager.ts`. glm has a status machine (`open`/`filling`/`closed`); claude has a simpler gap model (boundary dates, no status) — good enough.

**Approach:** 
- `POST /sync/gaps/:id/fill` — look up the gap, call `gmail.fetchMessagesInRange(newerBoundary, olderBoundary, batchSize)`, upsert, update/delete the gap.
- `DELETE /sync/gaps/:id` — just `db.deleteGap(id)`.

Factor the existing gap-fill loop inside `runSyncCycle` (sync.ts lines ~61–97) into a reusable `fillSingleGap(db, gmail, gap, batchSize)` so the route and the sync cycle share logic.

**Files:**
- Modify: `packages/backend/src/services/sync.ts` — extract `fillSingleGap` helper.
- Modify: `packages/backend/src/routes/sync.ts` — add routes.
- Modify: `packages/backend/src/routes/sync.test.ts`
- Modify: `packages/backend/src/services/db.ts` — add `getGap(id)`.

- [ ] **Step 1: Failing test**

```ts
it('POST /sync/gaps/:id/fill fills from gmail', async () => {
  const gap = db.createGap({ newerBoundary: '2025-02-01T00:00:00Z', olderBoundary: '2025-01-01T00:00:00Z', estimatedCount: 0 });
  gmailMock.fetchMessagesInRange = vi.fn().mockResolvedValue([{ id: 'g1', /* ... */ date: '2025-01-15T00:00:00Z' }]);
  const res = await app.inject({ method: 'POST', url: `/sync/gaps/${gap.id}/fill` });
  expect(res.statusCode).toBe(200);
  expect(res.json().fetched).toBe(1);
  expect(db.getEmail('g1')).not.toBeNull();
});

it('DELETE /sync/gaps/:id removes the gap', async () => {
  const gap = db.createGap({ newerBoundary: '2025-02-01', olderBoundary: '2025-01-01', estimatedCount: 0 });
  const res = await app.inject({ method: 'DELETE', url: `/sync/gaps/${gap.id}` });
  expect(res.statusCode).toBe(200);
  expect(db.listGaps()).toHaveLength(0);
});

it('POST /sync/gaps/:id/fill returns 404 for missing gap', async () => {
  const res = await app.inject({ method: 'POST', url: '/sync/gaps/9999/fill' });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

In `services/db.ts`:
```ts
getGap(id: number): Gap | null;

// impl:
getGap(id) {
  const row = db.prepare('SELECT * FROM sync_gaps WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    newerBoundary: row.newer_boundary as string,
    olderBoundary: row.older_boundary as string,
    estimatedCount: row.estimated_count as number,
  };
},
```

In `services/sync.ts`:
```ts
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
```

Also refactor the gap loop in `runSyncCycle` to call `fillSingleGap` (cleanup — reduces buggy branch at line 84).

In `routes/sync.ts`:
```ts
app.post('/sync/gaps/:id/fill', async (request, reply) => {
  const id = Number((request.params as any).id);
  const gap = db.getGap(id);
  if (!gap) return reply.code(404).send({ error: 'Gap not found' });
  const result = await fillSingleGap(db, gmail, gap, defaultBatchSize);
  return result;
});

app.delete('/sync/gaps/:id', async (request, reply) => {
  const id = Number((request.params as any).id);
  const gap = db.getGap(id);
  if (!gap) return reply.code(404).send({ error: 'Gap not found' });
  db.deleteGap(id);
  return { ok: true };
});
```

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/routes/sync.test.ts src/services/sync.test.ts
git add packages/backend/src/services/db.ts packages/backend/src/services/sync.ts packages/backend/src/routes/sync.ts packages/backend/src/routes/sync.test.ts
git commit -m "feat(sync): manual gap fill and abandon endpoints"
```

---

## Feature F15: TUI detail-panel full-width toggle `[source: both]`

**glm reference:** `src/tui/components/detail-panel.ts` lines 10, 74–100 — boolean `showingFullWidth` state, `toggleView()` / `setFullWidth()` / `setNormalView()` methods. Bound to a key in `src/tui/app.ts` lines 52/60.

**Claude layout:** `packages/terminal/src/views/email.ts` renders the email detail view. Investigate whether detail is rendered inline with the list (split pane) or as a standalone view. If standalone, "full-width" may already be default — in which case the feature is "split view with toggle to full-width", which requires a list+detail split. Check the current implementation first; if no split exists, the minimal version of this feature is a keybinding that expands the detail view to hide the list sidebar.

**Files:**
- Modify: `packages/terminal/src/views/email.ts`
- Modify: `packages/terminal/src/app.ts` — key binding.
- Modify: `packages/terminal/src/app.test.ts`

- [ ] **Step 1: Read `packages/terminal/src/views/email.ts` and `app.ts`**

Determine current layout. If there's no split view currently, document the decision in the commit message and implement the minimum: pressing `f` in the email view toggles between a "metadata + preview" compact layout and a "body fills screen" layout.

- [ ] **Step 2: Write failing test**

```ts
it('toggles detail full-width on f key', async () => {
  const app = createApp({ /* mocks */ });
  app.openEmail('abc');
  expect(app.detailFullWidth).toBe(false);
  app.handleKey('f');
  expect(app.detailFullWidth).toBe(true);
  app.handleKey('f');
  expect(app.detailFullWidth).toBe(false);
});
```

- [ ] **Step 3: Verify fail**

- [ ] **Step 4: Implement**

In `views/email.ts`, add `detailFullWidth: boolean` state; when true, use `width: '100%'` for the detail box; when false, reserve space for a sidebar/list as currently configured. In `app.ts`, bind `'f'` key in the email view to toggle the flag and re-render.

Since the exact OpenTUI APIs differ, the implementing agent should mirror the existing toggle patterns already used in the codebase (e.g., existing show/hide of search bar if any).

- [ ] **Step 5: Verify and commit**

```
cd packages/terminal && npx vitest run
git add packages/terminal/src/views/email.ts packages/terminal/src/app.ts packages/terminal/src/app.test.ts
git commit -m "feat(tui): detail-panel full-width toggle"
```

---

## Feature F16: Fix `trashEmail()` leaves `INBOX` label so deleted mail reappears `[source: codex]`

**Bug:** Codex found that `trashEmail()` in `packages/backend/src/services/db.ts` adds the `TRASH` label but does not remove `INBOX`, and `listEmails()` still matches `labels LIKE '%INBOX%'`, so trashed messages reappear on the next `/emails` reload. glm avoids this via `removed_state IS NULL` filtering.

**Phase:** Execute at the start of Phase C, BEFORE F7. F7 replaces the label-based removal model with `removed_state` and will naturally supersede this bug, but landing a focused fix first means:
1. The bug is gone on its own commit — bisectable, shippable independently of F7.
2. F7's tests have a clean baseline (no pre-existing `trashEmail()` misbehavior polluting fixtures).
3. Between F16 and F7 merging, users are not exposed to the bug.

**Files:**
- Modify: `packages/backend/src/services/db.ts` — `trashEmail()` and `archiveEmail()` (check if archive has the same class of bug).
- Modify: `packages/backend/src/services/db.test.ts`

- [ ] **Step 1: Investigate both `trashEmail()` and `archiveEmail()`**

Read `packages/backend/src/services/db.ts`. Confirm:
- `trashEmail(id)` current behavior: adds `TRASH` to labels JSON array, leaves `INBOX`.
- `archiveEmail(id)` current behavior: likely removes `INBOX` already (archive is "remove from inbox"); verify.
- `listEmails()` inbox default filter: `labels LIKE '%INBOX%'`.

- [ ] **Step 2: Write failing test**

In `packages/backend/src/services/db.test.ts`:

```ts
it('trashEmail removes INBOX so the email no longer appears in listEmails', () => {
  const db = createDb(':memory:');
  db.upsertEmail({
    id: 'bug1', threadId: 't', subject: 's', from: 'x',
    date: '2025-01-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
    labels: ['INBOX', 'UNREAD'], summary: null,
  });
  expect(db.listEmails({}).map(e => e.id)).toContain('bug1');
  db.trashEmail('bug1');
  expect(db.listEmails({}).map(e => e.id)).not.toContain('bug1');
  const row = db.getEmail('bug1');
  expect(row?.labels).toContain('TRASH');
  expect(row?.labels).not.toContain('INBOX');
  db.close();
});
```

- [ ] **Step 3: Run and verify fail**

```
cd packages/backend && npx vitest run src/services/db.test.ts -t trashEmail
```

Expected: FAIL — asserts that `bug1` is absent from list, but current `trashEmail` leaves `INBOX` so list still contains it.

- [ ] **Step 4: Implement fix**

In `packages/backend/src/services/db.ts`, update `trashEmail`:

```ts
trashEmail(id) {
  const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
  if (!row) return;
  const labels = (JSON.parse(row.labels) as string[]).filter(l => l !== 'INBOX');
  if (!labels.includes('TRASH')) labels.push('TRASH');
  db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(labels), id);
},
```

If the investigation in Step 1 found `archiveEmail` has the same shape of bug, apply the analogous fix (remove `INBOX`, don't add `TRASH`).

- [ ] **Step 5: Verify pass**

```
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add packages/backend/src/services/db.ts packages/backend/src/services/db.test.ts
git commit -m "fix(db): trashEmail removes INBOX label so deleted mail stays hidden"
```

---

## Feature F17: Gmail API retry/backoff for 429/500/503 `[source: codex]` `[nice-to-have]`

**glm reference:** `src/backend/gmail/gmail-api.ts` — wraps every Gmail call in a retry helper with exponential backoff for HTTP 429, 500, 503.

**Claude today:** `packages/backend/src/services/gmail.ts` calls `google.gmail(...)` directly with no retry layer. Transient 429/500/503 responses surface as route-level 500s.

**Approach:** Add an internal `withRetry<T>(fn: () => Promise<T>): Promise<T>` helper private to `services/gmail.ts`. Retry on errors whose `.code` (or `.response?.status`) is 429, 500, or 503. Cap at 4 attempts. Backoff: 500ms, 1s, 2s (plus jitter ±100ms). Do NOT retry on 4xx other than 429.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts`
- Modify: `packages/backend/src/services/gmail.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('withRetry retries twice on 429 then succeeds', async () => {
  let calls = 0;
  const fn = vi.fn().mockImplementation(async () => {
    calls++;
    if (calls < 3) { const err: any = new Error('rate'); err.code = 429; throw err; }
    return 'ok';
  });
  const result = await withRetryForTest(fn, { maxAttempts: 4, baseDelayMs: 1 });
  expect(result).toBe('ok');
  expect(fn).toHaveBeenCalledTimes(3);
});

it('withRetry does not retry on 400', async () => {
  const fn = vi.fn().mockImplementation(async () => { const err: any = new Error('bad'); err.code = 400; throw err; });
  await expect(withRetryForTest(fn, { maxAttempts: 4, baseDelayMs: 1 })).rejects.toMatchObject({ code: 400 });
  expect(fn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify fail**

```
cd packages/backend && npx vitest run src/services/gmail.test.ts -t withRetry
```

Expected: FAIL — `withRetryForTest` not exported.

- [ ] **Step 3: Implement**

In `packages/backend/src/services/gmail.ts`:

```ts
interface RetryOpts { maxAttempts: number; baseDelayMs: number; }
const RETRIABLE_CODES = new Set([429, 500, 503]);

async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = { maxAttempts: 4, baseDelayMs: 500 }): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err: any) {
      const code = err?.code ?? err?.response?.status;
      if (!RETRIABLE_CODES.has(code) || attempt === opts.maxAttempts) throw err;
      const jitter = Math.floor(Math.random() * 200) - 100;
      const delay = Math.max(0, opts.baseDelayMs * 2 ** (attempt - 1) + jitter);
      await new Promise(r => setTimeout(r, delay));
      lastErr = err;
    }
  }
  throw lastErr;
}

// Export for tests only (alias avoids public API surface):
export const withRetryForTest = withRetry;
```

Wrap every `await gmail.users.*` call in the service with `withRetry(() => gmail.users.*.X({...}))`. Keep the interface unchanged — callers see no difference.

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/services/gmail.test.ts
git add packages/backend/src/services/gmail.ts packages/backend/src/services/gmail.test.ts
git commit -m "feat(gmail): retry with exponential backoff on 429/500/503"
```

---

## Feature F18: Verbose LLM request/response logging `[source: codex]` `[nice-to-have]`

**glm reference:** `src/backend/llm/openai-adapter.ts` and `src/backend/llm/anthropic-adapter.ts` — log request prompt and response body at a configurable verbosity level.

**Claude today:** `packages/backend/src/services/ai.ts` makes LLM calls with no tracing beyond error logs. Debugging prompt/response issues requires attaching a proxy.

**Approach:** Add `llmVerboseLogging: boolean` to `AppConfig`. When true, log request (model, messages snippet or full, max tokens) at `info` and response (usage tokens, content snippet) at `info`. Truncate content to 500 chars per line to avoid flooding. Never log API keys or full auth headers.

**Files:**
- Modify: `packages/backend/src/services/ai.ts`
- Modify: `packages/backend/src/services/ai.test.ts`
- Modify: `packages/shared/src/types.ts` — `AppConfig.llmVerboseLogging?: boolean`.
- Modify: `packages/backend/src/config.ts` — load/default.

- [ ] **Step 1: Failing test**

```ts
it('logs request and response when verbose logging enabled', async () => {
  const logs: string[] = [];
  const logger = { info: (msg: string) => logs.push(msg), error: () => {} };
  const ai = createAiService({
    provider: 'openai', apiKey: 'k', model: 'gpt', baseUrl: 'http://x', verbose: true, logger,
  } as any);
  // Mock fetch to return a canned response
  // ...
  await ai.summarizeEmail({ subject: 's', bodyText: 'hello' } as any);
  expect(logs.some(l => l.includes('[ai] request'))).toBe(true);
  expect(logs.some(l => l.includes('[ai] response'))).toBe(true);
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

In `services/ai.ts`, accept an optional `verbose: boolean` and `logger` (fall back to `console`). Inside each LLM call:

```ts
if (verbose) logger.info(`[ai] request model=${model} prompt=${truncate(prompt, 500)}`);
const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
const json = await res.json();
if (verbose) logger.info(`[ai] response usage=${JSON.stringify(json.usage ?? {})} content=${truncate(extract(json), 500)}`);
```

Where `truncate(s, n) = s.length > n ? s.slice(0, n) + '…' : s`.

In `server.ts`, pass `verbose: config.llmVerboseLogging ?? false, logger: app.log` into `createAiService`.

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/services/ai.test.ts
git add packages/backend/src/services/ai.ts packages/backend/src/services/ai.test.ts packages/backend/src/config.ts packages/backend/src/server.ts packages/shared/src/types.ts
git commit -m "feat(ai): opt-in verbose LLM request/response logging"
```

---

## Feature F19: Sync fetches only `INBOX` from Gmail API `[source: codex]` `[nice-to-have]`

**glm reference:** `src/backend/services/sync.ts` and `src/backend/services/gap-manager.ts` — pass `labelIds: ['INBOX']` to `users.messages.list`.

**Claude today:** `packages/backend/src/services/gmail.ts` `fetchMessagesSince`/`fetchMessagesInRange` build date-only queries and do NOT pass `labelIds`, so archived/trashed Gmail messages falling within the date window get pulled into the DB and filtered out only at list time via `labels LIKE '%INBOX%'`. This wastes API quota and DB writes.

**Approach:** Add `labelIds: ['INBOX']` to the `users.messages.list` calls used during sync. Do NOT apply this to `listHistory` (F2) — history is cursor-based and Gmail already scopes deltas. Do NOT apply to `getRawMessage` (F10) or `fetchMessagesById` (F2) — those are explicit single-message fetches.

**Files:**
- Modify: `packages/backend/src/services/gmail.ts`
- Modify: `packages/backend/src/services/gmail.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('fetchMessagesSince passes labelIds=[INBOX]', async () => {
  const listMock = vi.fn().mockResolvedValue({ data: { messages: [], historyId: '1' } });
  const getMock = vi.fn();
  // inject google.gmail mock that records .users.messages.list calls
  // ...
  await gmail.fetchMessagesSince(null, 10);
  expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ labelIds: ['INBOX'] }));
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

In `services/gmail.ts`, in `fetchMessagesSince` and `fetchMessagesInRange`, change:

```ts
const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
```

to:

```ts
const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults, labelIds: ['INBOX'] });
```

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/services/gmail.test.ts
git add packages/backend/src/services/gmail.ts packages/backend/src/services/gmail.test.ts
git commit -m "feat(gmail): restrict sync list calls to INBOX label"
```

---

## Feature F20: Periodic summarizer timer independent of sync `[source: codex]` `[nice-to-have]`

**glm reference:** `src/backend/services/summary-worker.ts` runs a `setInterval` loop independent of sync; claude's summarizer only runs when explicitly triggered (`summarizer.trigger()` after sync).

**Claude today:** `packages/backend/src/services/summarizer.ts` exports `trigger()` which kicks a single run. After the run drains, the worker goes idle until the next sync. Messages that fail with `429` and get skipped in one run don't get retried until the next sync.

**Approach:** Add an optional periodic timer inside `createSummarizer` that calls the existing drain loop on an interval. Controlled by `config.summarizer.intervalMs` (default `0` = disabled). Re-entry guarded the same way F3's auto-poller is.

**Files:**
- Modify: `packages/backend/src/services/summarizer.ts`
- Modify: `packages/backend/src/services/summarizer.test.ts`
- Modify: `packages/backend/src/server.ts` — start/stop timer with the app.
- Modify: `packages/shared/src/types.ts` — `AppConfig.summarizer?: { intervalMs?: number }`.

- [ ] **Step 1: Failing test**

```ts
it('periodic summarizer drains on interval', async () => {
  vi.useFakeTimers();
  const summarizer = createSummarizer({ /* deps */, intervalMs: 1000 });
  const drainSpy = vi.spyOn(summarizer as any, 'drain');
  summarizer.startTimer();
  await vi.advanceTimersByTimeAsync(2500);
  expect(drainSpy).toHaveBeenCalledTimes(2);
  summarizer.stopTimer();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Implement**

In `services/summarizer.ts` add to the returned interface:

```ts
startTimer(): void;
stopTimer(): void;
```

Implementation:

```ts
let timer: ReturnType<typeof setInterval> | null = null;
// ... inside factory
startTimer() {
  if (timer || !opts.intervalMs || opts.intervalMs <= 0) return;
  timer = setInterval(() => { void trigger(); }, opts.intervalMs);
},
stopTimer() { if (timer) { clearInterval(timer); timer = null; } },
```

In `server.ts`, after constructing the summarizer:

```ts
summarizer.startTimer();
app.addHook('onClose', async () => summarizer.stopTimer());
```

Extend `AppConfig` in shared types:

```ts
export interface AppConfig {
  // ...
  summarizer?: { intervalMs?: number };
}
```

- [ ] **Step 4: Verify and commit**

```
cd packages/backend && npx vitest run src/services/summarizer.test.ts
git add packages/backend/src/services/summarizer.ts packages/backend/src/services/summarizer.test.ts packages/backend/src/server.ts packages/shared/src/types.ts
git commit -m "feat(summarizer): optional periodic timer independent of sync"
```

---

## Skipped items

Items present in the comparisons but deliberately NOT planned for porting:

- **F4 `syncInProgress` mutex / fire-and-forget `/sync`** `[source: both]` — claude already has equivalent functionality in a different shape: `/sync` is synchronous and returns detailed counts, which is strictly more informative than glm's `202 { status: "syncing" }` + in-memory mutex. Porting glm's async contract would be a regression, not an improvement. Clients differ; don't unify.
- **Page-token-based gap tracking** `[source: both]` — claude uses date-boundary gaps (`sync_gaps.newer_boundary`/`older_boundary`); glm uses pageToken cursors. Different models of the same problem. Claude's model is already implemented and works.

---

## Self-review checklist

- **Spec coverage:** F1–F15 map 1:1 to the original 15 feature bullets. F16 adds the `trashEmail()` bug fix (Codex finding, bug not feature). F17–F20 add Codex-only nice-to-haves. F4 is skipped (see Skipped items). Check.
- **Dependency ordering:** F6 (removed_state) lands in Phase A before F2 (incremental sync, which calls `markEmailRemoved` on messagesDeleted) and before F7/F8 (routes that use it). F5 (listLabels) lands before F11 (label filter route). F1 (historyId persistence) lands before F2. F4 (mutex) is standalone.
- **Type consistency:**
  - `DbHandle` additions: `setLastHistoryId`, `markEmailRemoved`, `clearEmailRemoved`, `setReadState`, `ping`, `getGap` — all consistently named.
  - `GmailService` additions: `listHistory`, `fetchMessagesById`, `listLabels`, `markRead`, `markUnread`, `getRawMessage` — verb-noun consistent.
  - `fetchMessagesSince` return type changes from `Email[]` to `{ emails: Email[]; historyId: string | null }` — this is a breaking change to the signature used in F2, flagged in F2 step 3; existing callers in `runSyncCycle` must be updated in the same commit.
  - `EmailListParams` additions: `label`, `unread`, `starred`, `hasActions` — shared type + DB + route all updated.
  - `SyncStatus` additions: `lastHistoryId`, `syncInProgress` — updated in F1 and F4 respectively.
- **No placeholders:** All code steps contain concrete code or direct pointers to adjacent code already in the plan.
- **Known-bug carve-out:** F14 refactors `runSyncCycle`'s gap loop, which is the exact area of the "gap-fill correctness" bug tracked separately; the plan says "cleanup — reduces buggy branch at line 84" but does NOT attempt to fix the bug. Implementing agent should leave the bug alone and let the separate bug-fix plan handle it.

---

## Execution handoff

Plan complete and saved to `/home/ckolbegger/src/gmail-sweep/worktrees/claude/docs/plan-port-glm-features-to-claude.md`. Two execution options when ready:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per feature (F1…F15), review between features.
2. **Inline Execution** — execute phases in one session using `superpowers:executing-plans`, checkpoint after each phase.
