# Spec & Plan Review — Gmail Sweep TUI

Reviewed: `2026-03-28-gmail-sweep-tui-design.md` (spec) and `2026-03-29-gmail-sweep-tui.md` (plan)

---

## Spec Issues

### 1. Archive/delete creates a ghost data problem
Archive removes the INBOX label on Gmail. If sync fetches all messages (not just INBOX), archived emails will be re-fetched on the next sync. No tombstone table, no `label:INBOX` filter on sync, nothing addresses this. The plan compounds it by saying archive "should remove the email from the local database," guaranteeing re-fetch.

### 3. Overly broad OAuth scopes
Requesting `gmail.compose` "for future reply/forward support" violates least-privilege. Google's verification process is stricter for broader scopes, and users see a scarier consent screen. Request only what MVP needs (`readonly` + `modify`).

### 4. Gap management has a fundamental Gmail API mismatch (HIGH RISK)

The gap boundary model uses `after_ts` / `before_ts` timestamps, but this doesn't align with how the Gmail API works:

- **`messages.list`** paginates via opaque `pageToken`, not timestamps. You can't request "messages between timestamp X and Y."
- **Gmail search operators** (`after:`, `before:`) have **day granularity only** — `after:2026/03/28`, not `after:2026-03-28T10:42:00Z`. Gap boundaries can't be targeted precisely.
- **`history.list`** (Gmail's recommended incremental sync mechanism) uses `historyId`, not timestamps. The spec never mentions `historyId`.

This means sync flow step 4 — "Fill gap from its `after_ts` downward" — can't be implemented as described. Day-granularity queries will over-fetch at boundaries, undermining the "remaining capacity" budget concept.

**Additional gap management issues:**

- **No `historyId` anywhere.** Gmail's intended incremental sync: store `historyId` from initial sync, call `history.list(startHistoryId)` for changes. More reliable than timestamp watermarks and avoids boundary problems for new-mail detection.
- **`resultSizeEstimate` is unreliable.** Gmail docs explicitly warn it's an estimate. The spec uses it for `estimated_count` and the plan uses it to decide when a gap is closed. Gaps should close based on "no more results returned," not "fetched count >= estimate."
- **Duplicate timestamps.** Multiple emails can share the same `date_received`. If a gap boundary lands on a shared timestamp, emails get missed or double-fetched. No dedup strategy is specified.
- **Race conditions.** The `status = 'filling'` state prevents concurrent fills in theory, but no locking mechanism is described. Two rapid `POST /sync` calls could race.
- **"Remaining capacity" conflates API calls.** Newest fetch and gap fill are separate Gmail API queries. The batch budget applies to local storage, not API pagination, but the spec describes it as one combined operation.

**Missing plan test cases for gap management:**
- New mail arrives during a gap fill
- Gap fill discovers more emails than `estimated_count`
- Emails deleted from Gmail while a gap is open
- How to determine a gap is truly closed given imprecise counts

**What the spec/plan need to add:**
- Decide whether sync is **history-based** (`historyId` for incremental) or **list-based** (`messages.list` pagination). History-based is Gmail's recommended pattern.
- Define gap boundaries using **Gmail message IDs or pageTokens**, not timestamps. Timestamps can remain for display/sorting but shouldn't be the boundary mechanism.
- Specify how gap fill actually works against the API — likely `messages.list` with a saved `pageToken` or a date-range query with client-side boundary filtering.
- Address `resultSizeEstimate` unreliability — close gaps on empty results, not count comparison.
- Add dedup logic for boundary emails.

### 5. Search label filter is fragile
`WHERE labels LIKE '%Finance%'` against a JSON column false-matches on substrings (e.g., "Personal Finance" matches `label:Finance`). Should use `json_each()` for correctness.

### 6. SQL reserved words as column names
`from` and `to` require quoting everywhere. Every query touching these columns needs double-quotes, and a single omission causes a syntax error. Consider `sender`/`recipients` instead.

### 7. tmux harness has a syntax error
Spec line 409: `${id -x 200 -y 50}` should be `${id} -x 200 -y 50`. The brace closes too late.

### 8. No embedding dimension specified
sqlite-vec needs the vector dimension at table/index creation. The spec never states it, nor how the virtual table is defined.

### 9. Sync appears synchronous
`POST /sync` is described as a request-response cycle that fetches from Gmail, fills gaps, triggers workers. If this blocks, the TUI freezes during sync. The spec doesn't clarify async dispatch vs. blocking.

---

## Plan Issues

### 10. `batch_id` references nothing in Slice 3
The initial schema (Task 1.3) includes `batch_id INTEGER` but `sync_batches` isn't created until Slice 5. Dangling foreign key for 3 slices.

### 11. Missing dependencies in `bun init`
Task 1.1 installs `hono` and `@types/bun`. Missing: TOML parser (Bun has no built-in TOML support), `sqlite-vec` native extension, OpenTUI (or whatever the real TUI lib is), and any testing utilities.

### 12. No sample `config.toml` is ever created
Task 1.2 builds the loader and tests it, but no actual config file is committed. The backend can't start without one.

### 13. Spec says workers run concurrently; plan makes them sequential
The embedding worker (Slice 7) only processes emails where `ai_status = done` — summaries must complete first. The spec says "Both run concurrently across emails." The plan's choice to embed `subject + summary` rather than raw body forces this dependency and ties search quality to summary quality.

### 14. Slice 3 detail panel is throwaway
Builds a full-email-only detail panel that Slice 6 reworks into a summary/toggle panel. The Slice 3 tests will need to be rewritten for Slice 6. This isn't incremental delivery — it's rework.

### 15. No worker lifecycle management
Task 6.6 says "start a background loop that processes pending summaries periodically" but has no tests, no graceful shutdown, no crash recovery, and no concurrency guard against duplicate processing.

### 16. No error path for real Gmail API tests
Task 3.1 tests the real Gmail API client but all those tests hit the network. The plan says "Mock Gmail adapter for all tests" at the top — so how are these tested? They need their own HTTP mock layer (not specified).

---

## Spec/Plan Inconsistencies

| Topic | Spec says | Plan does |
|-------|-----------|-----------|
| Worker concurrency | Both run concurrently | Embedding depends on summary completion |
| Embedding input | Not specified | Subject + summary (creates dependency) |
| Archive behavior | Removes INBOX label on Gmail | Also deletes from local DB (re-sync problem) |
| Detail panel default | Summary mode | Slice 3 builds full-email-only, reworked in Slice 6 |
| Theme | `tokyo-night` in config | `theme.ts` file listed but no theming spec |

---

## Recommendations

1. **Redesign gap management around Gmail API realities.** Use `historyId` for incremental sync of new mail. Use message IDs or pageTokens (not timestamps) as gap boundaries. Close gaps on empty results, not count estimates.
2. **Add a `synced_message_ids` or label filter** to prevent archived emails from being re-fetched.
3. **Remove `gmail.compose` scope** from MVP.
4. **Decide sync semantics** — async (return 202, poll status) or blocking (simpler but freezes TUI). Spec needs to be explicit.
5. **Drop `batch_id`** from the initial schema if `sync_batches` comes later, or move it to Slice 1.
