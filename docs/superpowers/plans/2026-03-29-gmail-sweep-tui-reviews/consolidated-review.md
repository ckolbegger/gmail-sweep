# Consolidated Spec & Plan Review — Gmail Sweep TUI

Reviewed: `2026-03-28-gmail-sweep-tui-design.md` (spec) and `2026-03-29-gmail-sweep-tui.md` (plan)

Sources: `claude-review.md`, `codex-review.md`

---

## Architectural Issues (resolve before implementation)

### 1. Gap-sync model relies on cursors the Gmail API does not provide (HIGH RISK)

#### The problem

The spec models sync and gap fill around timestamp boundaries (`after_ts` / `before_ts`). This doesn't work with the Gmail API:

- **`messages.list`** paginates via opaque `pageToken`, not timestamps. You can't request "messages between timestamp X and Y."
- **Gmail search operators** (`after:`, `before:`) have **day granularity only** — `after:2026/03/28`, not `after:2026-03-28T10:42:00Z`. Precise gap boundaries can't be targeted.
- **`history.list`** (Gmail's recommended incremental sync mechanism) uses `historyId`, not timestamps. The spec never mentions `historyId`.

Sync flow step 4 — "Fill gap from its `after_ts` downward" — can't be implemented as described. The "remaining capacity" budget concept also breaks down because newest-fetch and gap-fill are necessarily separate API call sequences, not slices of a single paginated request.

Additional issues with the current design:

- **`resultSizeEstimate` is unreliable.** Gmail docs explicitly warn it's an estimate. Using it to decide when a gap is closed will misfire.
- **Duplicate timestamps.** Multiple emails can share the same `date_received`. Timestamp boundaries will miss or double-fetch at collision points.
- **Race conditions.** The `status = 'filling'` state prevents concurrent fills in theory, but no locking mechanism is described. Two rapid `POST /sync` calls could race.

#### Proposed architecture

Gmail provides two complementary sync mechanisms. The spec conflates them into one timestamp model; the correct design uses **both for their intended purposes:**

**1. Incremental sync (new mail) — use `history.list` + `historyId`**

Gmail's `history.list` API returns all changes (messages added, deleted, labels changed) since a given `historyId`. This is Gmail's recommended approach for "what's new since I last checked" and avoids all timestamp boundary problems for new mail detection.

- On first sync, call `messages.list` to get the initial batch. The response includes the current `historyId` — store it.
- On subsequent syncs, call `history.list(startHistoryId=<stored>)`. This returns message IDs that were added/deleted/modified since the last sync.
- Fetch full message content for any new IDs. Update local state for deletions and label changes.
- Store the new `historyId` after each successful incremental sync.
- If `historyId` is expired (Google keeps ~30 days), fall back to a full `messages.list` resync and store the new `historyId`.

This completely eliminates the "fetch newest since last high watermark" timestamp problem. No timestamp comparison, no day-granularity issues, no duplicate-timestamp collisions for new mail.

**2. Historical backfill (gap fill) — use `messages.list` + `pageToken`**

When the initial sync (or any sync) doesn't fetch the full mailbox, a gap exists for older messages. Gmail's `pageToken` is the correct cursor for resuming pagination:

- After the initial `messages.list` call, if `nextPageToken` is present, store it as a gap.
- To fill the gap, call `messages.list(pageToken=<stored>)`. This resumes pagination exactly where it left off.
- If the fill returns another `nextPageToken`, update the gap's cursor.
- If no `nextPageToken` is returned, the gap is closed — **all historical messages have been reached.**
- Gap closure is determined by the absence of `nextPageToken`, **not** by comparing counts to `resultSizeEstimate`.

This eliminates the timestamp boundary problem for backfill. `pageToken` is Gmail's own stable cursor into the result set.

**3. Revised data model**

```sql
-- Replace the spec's sync_batches + gaps tables with:

sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,  -- singleton row
  last_history_id TEXT,               -- for history.list incremental sync
  last_sync_at INTEGER                -- informational
)

gaps (
  id INTEGER PRIMARY KEY,
  page_token TEXT NOT NULL,           -- Gmail pageToken for resumption
  estimated_count INTEGER,            -- informational only (from resultSizeEstimate)
  status TEXT DEFAULT 'open',         -- 'open' | 'filling' | 'closed'
  created_at INTEGER,
  updated_at INTEGER
)
```

Key changes from the spec:
- `after_ts` / `before_ts` replaced by `page_token` — the actual Gmail cursor.
- `sync_batches` table replaced by `sync_state` singleton with `last_history_id`.
- `estimated_count` is retained for UI display but is **never used for gap closure decisions.**

**4. Revised GmailAdapter interface**

The spec's `GmailAdapter` (spec:77) needs to expose the history API:

```typescript
interface GmailAdapter {
  // existing methods...
  listMessages(options: { maxResults: number, pageToken?: string }): Promise<{
    messages: GmailMessage[]
    nextPageToken?: string
    resultSizeEstimate?: number
    historyId: string              // ADD: needed for incremental sync setup
  }>

  // ADD: for incremental sync
  listHistory(startHistoryId: string): Promise<{
    history: HistoryRecord[]       // added/deleted/labelChanged message IDs
    historyId: string              // new cursor for next call
  }>
}
```

**5. Revised sync flow for `POST /sync`**

```
1. If sync_state.last_history_id exists:
   a. Call history.list(startHistoryId) for incremental changes
   b. Fetch full content for newly added message IDs
   c. Apply deletions and label changes to local DB
   d. Update sync_state.last_history_id
   e. If history.list fails with 404 (historyId expired), fall through to step 2

2. If no last_history_id or it expired:
   a. Call messages.list(maxResults=batchSize) for initial/full sync
   b. Store historyId from response into sync_state
   c. If nextPageToken exists, create a gap with that pageToken

3. If open gaps exist and batch budget remains:
   a. Pick highest-priority open gap
   b. Call messages.list(pageToken=gap.page_token)
   c. If response has nextPageToken, update gap's page_token
   d. If response has no nextPageToken, close the gap
   e. Dedup: skip any message IDs already in the local DB (INSERT OR IGNORE)

4. Store all fetched emails, trigger summary/embedding workers
```

**6. Concurrency control**

To prevent race conditions from concurrent `POST /sync` calls:
- Use a SQLite transaction with `UPDATE gaps SET status = 'filling' WHERE id = ? AND status = 'open'` — the row-level check-and-set is atomic within SQLite's serialized write model.
- If the UPDATE affects 0 rows, another sync is already filling that gap; skip it.
- The sync endpoint itself should be guarded with a simple in-memory mutex (or return 409 if a sync is already in progress).

#### Why this matters

The timestamp-based model in the spec cannot be implemented correctly against the Gmail API. Any implementation attempt would either: (a) use imprecise day-granularity queries and deal with over-fetching and dedup at boundaries, or (b) abandon the spec's gap model entirely and ad-hoc something cursor-based. Both paths lead to bugs or rework. Defining the correct cursor model up front eliminates an entire class of boundary problems.

References:
- `spec:77` (GmailAdapter interface — only exposes `maxResults`/`pageToken`)
- `spec:126-143` (sync_batches + gaps schema with timestamp boundaries)
- `spec:148-158` (sync flow steps)
- `plan:481` (getHighWatermark based on timestamp)
- `plan:693` (fillGap test — assumes timestamp-based fill)

### 2. Vector search architecture is not concrete enough to implement

The spec stores embeddings directly on `emails.embedding` as a `BLOB` while assuming `sqlite-vec` ranking and filtered semantic search. Neither the spec nor the plan defines the `sqlite-vec` virtual table, its dimension, or the index lifecycle. The plan only tests that the embedding is stored "as BLOB in sqlite-vec format."

Without this, there is no clear path from the schema to efficient vector queries. Semantic search may either not work or devolve to full table scans.

**Resolution required:**
- Specify the embedding dimension (e.g., 1536 for `text-embedding-3-small`).
- Define the `sqlite-vec` virtual table DDL and when it's created.
- Specify how filtered vector search works — does `sqlite-vec` support pre-filtering, or must SQL filters run first and then vector similarity rank the subset?

References:
- `spec:42` (sqlite-vec mentioned)
- `spec:197` (vector search in search flow)
- `spec:225` (`embedding BLOB` column)
- `plan:978` (embedding stored "in sqlite-vec format")

### 3. Failed mutation handling is contradictory

The spec says network failures should "queue operations for retry." The plan removes archived and deleted emails from the local database immediately and never defines an outbox, pending-operation state, or replay flow.

If the Gmail API call fails *after* local removal, local and remote state silently diverge. This is especially bad for archive/delete because they are destructive from the local UI perspective — the email vanishes from the list with no way to recover it locally.

Separately, if sync fetches all messages (not just INBOX), archived emails that were removed locally will be re-fetched on the next sync, creating ghost duplicates.

**Resolution required:**
- Either: apply local changes optimistically but roll back on API failure.
- Or: only remove locally after confirmed remote success.
- Add a sync filter (e.g., `label:INBOX` only) or tombstone table to prevent re-fetch of archived emails.

References:
- `spec:368` ("Queue operations for retry")
- `plan:602-604` (archive removes from local DB)
- `plan:609-611` (delete removes from local DB)

### 4. Auth contract diverges between spec and plan

The spec says the backend opens the browser automatically and receives a callback at `/oauth/callback`. The plan introduces `GET /auth/url`, `GET /auth/callback`, and `GET /auth/status`, and tells the user to visit `/auth/url` manually. The spec's REST endpoint table omits auth routes entirely.

These are materially different UX and route contracts. Implementation will drift depending on which document the implementer follows.

**Resolution required:**
- Align on one flow (auto-open or manual-visit) and update both documents.
- Add auth routes to the spec's REST endpoint table.

References:
- `spec:56-58` (auto-open browser flow)
- `spec:92-108` (REST endpoint table — no auth routes)
- `plan:346-362` (manual /auth/url flow)
- `plan:392` (TUI shows "visit /auth/url" instructions)

---

## Design Issues

### 5. Search/filter semantics are internally inconsistent

The spec stores labels as JSON text (`[{"id":"Label_1","name":"Finance"}]`) but defines `label:` search using `WHERE labels LIKE '%Finance%'`. This false-matches on substrings (e.g., "Personal Finance" matches `label:Finance`). Should use `json_each()` for correctness. The plan later expects proper JSON-based filtering, contradicting the spec's LIKE approach.

References:
- `spec:179` (`LIKE '%Finance%'`)
- `spec:214` (labels as JSON array)
- `plan:959` (filter building tests)

### 6. TUI interaction model is ambiguous

The spec says `Tab` toggles summary/full, but also says `Enter` opens full email in the detail panel. The plan never assigns behavior to `Enter`. Separately, the status bar is expected to host key hints, auth state, search input, sync feedback, errors, and queue depth with no priority model for what displays when.

References:
- `spec:291-301` (Tab and Enter keybindings)
- `spec:313` (search replaces status bar)
- `plan:392` (auth status in status bar)
- `plan:774` (sync status in status bar)

### 7. Sync appears synchronous

`POST /sync` is described as a request-response cycle that fetches from Gmail, fills gaps, and triggers workers. If this blocks, the TUI freezes during sync. The spec doesn't clarify async dispatch vs. blocking.

**Resolution required:**
- Either: `POST /sync` returns 202 with a job ID, TUI polls status.
- Or: sync is blocking but runs in a background thread from the TUI's perspective.

### 8. Spec says workers run concurrently; plan makes them sequential

The spec says summary and embedding workers "run concurrently across emails." The plan's embedding worker (Slice 7) only processes emails where `ai_status = done` — summaries must complete first. The plan's choice to embed `subject + summary` rather than raw body forces this dependency and ties search quality to summary quality.

**Resolution required:**
- If embeddings depend on summaries, update the spec to reflect the pipeline dependency.
- If they should be truly concurrent, embed raw email body instead of summary.

### 9. Provider config example is misleading

The config assumes an "OpenAI-compatible" endpoint but uses `claude-sonnet-4-6` as the example `summary_model`. This may be valid behind a proxy but is confusing and a risky default assumption without explanation.

References:
- `spec:329-332`

---

## Plan-Level Issues

### 11. `batch_id` references nothing in Slice 3

The initial schema (Task 1.3) includes `batch_id INTEGER` but `sync_batches` isn't created until Slice 5. Dangling foreign key for 3 slices.

References:
- `plan:201`

### 12. Missing dependencies in `bun init`

Task 1.1 installs `hono` and `@types/bun`. Missing: TOML parser (Bun has no built-in TOML support), `sqlite-vec` native extension, `@opentui/core`, and any testing utilities.

### 13. No sample `config.toml` is ever created

Task 1.2 builds the loader and tests it, but no actual config file is committed. The backend can't start without one.

### 14. Slice 3 detail panel is throwaway

Builds a full-email-only detail panel that Slice 6 reworks into a summary/toggle panel. The Slice 3 tests will need to be rewritten for Slice 6.

### 15. No worker lifecycle management

Task 6.6 says "start a background loop that processes pending summaries periodically" but has no tests, no graceful shutdown, no crash recovery, and no concurrency guard against duplicate processing.

### 16. No error path for real Gmail API tests

Task 3.1 tests the real Gmail API client but all those tests hit the network. The plan says "Mock Gmail adapter for all tests" at the top — so how are these tested? They need their own HTTP mock layer (not specified).

### 17. Plan drops parts of the published API contract

The spec says `GET /emails` is filterable by label and read status, and `GET /sync/status` includes watermark positions and worker queue depth. The plan only tests unread filtering on `/emails` and basic counts on `/sync/status`.

References:
- `spec:96` (`GET /emails` — filterable by label)
- `spec:103` (`GET /sync/status` — watermark + queue depth)
- `plan:506` (only tests `is_read` filtering)
- `plan:533` (only tests basic counts)

---

## Minor Issues

### 18. SQL reserved words as column names

`from` and `to` require quoting in every query. Consider `sender`/`recipients`.

### 19. tmux harness has a syntax error

Spec line 409: `${id -x 200 -y 50}` should be `${id} -x 200 -y 50`.

### 20. OAuth scopes exceed MVP needs

Requesting `gmail.compose` for future reply/forward violates least-privilege. Request only `readonly` + `modify` for MVP.

References:
- `spec:69`

---

## Spec/Plan Inconsistencies

| Topic | Spec says | Plan does |
|-------|-----------|-----------|
| Gap boundaries | Timestamp-based `after_ts`/`before_ts` | Tests assume timestamp queries work against Gmail API |
| Worker concurrency | Both run concurrently | Embedding depends on summary completion |
| Embedding input | Not specified | Subject + summary (creates pipeline dependency) |
| Mutation failure | Queue for retry | Remove from local DB immediately, no retry |
| Archive re-sync | Not addressed | Removes locally, guaranteeing re-fetch |
| Auth flow | Auto-open browser, callback at `/oauth/callback` | Manual visit to `/auth/url`, separate status endpoint |
| Auth routes | Not in REST endpoint table | Three new routes defined |
| `GET /emails` filtering | By label and read status | Only tests unread filtering |
| `GET /sync/status` | Watermark positions + worker queue depth | Basic counts only |
| Detail panel default | Summary mode | Slice 3 builds full-email-only, reworked in Slice 6 |
| Search label filter | `LIKE '%Finance%'` | Tests expect JSON-based filtering |
| Theme | `tokyo-night` in config | `theme.ts` listed but no theming spec |

---

## Test Cases to Add

The following test cases are not present in the plan but are needed based on issues identified in this review.

### Incremental sync via history.list (Slice 5)

```
describe('Incremental sync', () => {
  it('should call history.list with stored last_history_id')
  it('should fetch full content for newly added message IDs from history')
  it('should apply deletions from history to local DB')
  it('should apply label changes from history to local DB')
  it('should update sync_state.last_history_id after successful sync')
  it('should fall back to full messages.list if historyId is expired (404)')
  it('should store new historyId from messages.list on fallback')
  it('should handle history.list returning no changes')
})
```

### Gap fill via pageToken (Slice 5)

```
describe('Gap fill', () => {
  it('should call messages.list with the gap pageToken')
  it('should update gap page_token when response has nextPageToken')
  it('should close gap when response has no nextPageToken')
  it('should never use resultSizeEstimate for gap closure decisions')
  it('should dedup via INSERT OR IGNORE when fetched messages already exist locally')
  it('should atomically set status to filling, skipping if already filling')
  it('should return gap to open status if fill fails partway through')
  it('should handle concurrent sync calls without double-filling the same gap')
})
```

### Gap creation (Slice 3/5)

```
describe('Gap creation', () => {
  it('should create a gap with nextPageToken from initial messages.list')
  it('should not create a gap when messages.list returns no nextPageToken')
  it('should store resultSizeEstimate as informational only')
})
```

### Failed mutation rollback (Slice 4)

```
describe('Email action failure handling', () => {
  it('should not remove email from local DB if Gmail archive call fails')
  it('should not remove email from local DB if Gmail delete call fails')
  it('should not update is_read locally if Gmail modifyLabels call fails')
  it('should return an error status to the TUI when a Gmail mutation fails')
  it('should leave the email list unchanged on mutation failure')
})
```

### Vector search lifecycle (Slice 7)

```
describe('sqlite-vec virtual table', () => {
  it('should create the vector virtual table with correct dimensions on DB init')
  it('should insert embeddings into the virtual table when generated')
  it('should delete embeddings from the virtual table when emails are removed')
  it('should perform filtered vector search (SQL filter first, then similarity rank)')
  it('should handle searches when no emails have embeddings yet')
  it('should handle searches when some but not all filtered emails have embeddings')
})
```

### API contract completeness (Slice 3)

```
describe('GET /emails filtering', () => {
  it('should support filtering by label name')
  it('should support filtering by multiple labels (AND)')
  it('should not false-match on label substrings')
})

describe('GET /sync/status detail', () => {
  it('should include high watermark timestamp')
  it('should include summary worker queue depth')
  it('should include embedding worker queue depth')
  it('should include open gap count and total estimated gap emails')
})
```

### Worker lifecycle (Slice 6)

```
describe('Summary worker lifecycle', () => {
  it('should shut down gracefully when the server stops')
  it('should not start duplicate worker loops')
  it('should resume processing after a crash without skipping or duplicating emails')
  it('should respect a configurable concurrency limit')
})
```

### Sync semantics (Slice 3/5)

```
describe('Sync dispatch', () => {
  it('should not block the HTTP response while fetching from Gmail')
  it('should return a sync job ID or status immediately')
  it('should allow TUI to poll sync progress without blocking')
})
```

### TUI status bar priority (Slice 3+)

```
describe('Status bar priority', () => {
  it('should show search input when in search mode, hiding other status')
  it('should show sync progress when actively syncing')
  it('should show auth instructions when not authorized, taking priority over other status')
  it('should show keybinding hints as the default when no other status is active')
})
```

---

## Recommendations

1. **Redesign gap management around Gmail API realities.** Use `history.list` + `historyId` for incremental sync of new mail. Use `messages.list` + `pageToken` for historical backfill. Replace timestamp-based gap boundaries with stored `pageToken` cursors. Close gaps when `nextPageToken` is absent, not by comparing counts. See finding #1 for proposed data model, adapter interface, and sync flow.
2. **Define the sqlite-vec virtual table** — dimensions, DDL, index lifecycle, and how filtered vector search executes.
3. **Fix mutation handling** — either roll back local state on API failure, or only apply locally after confirmed remote success. Add a sync filter or tombstone to prevent re-fetch of archived emails.
4. **Align auth contract** — pick one flow (auto-open or manual-visit), update both spec and plan, add auth routes to the spec's endpoint table.
5. **Remove `gmail.compose` scope** from MVP.
6. **Decide sync semantics** — async (return 202, poll status) or blocking. Spec needs to be explicit.
7. **Drop `batch_id`** from the initial schema if `sync_batches` comes later, or introduce both in Slice 1.
8. **Clarify `Enter` vs `Tab`** behavior and define status bar priority rules.
