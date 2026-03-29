# Gmail Sweep — TUI Client Design

## Overview

A terminal-based Gmail client with AI-assisted email triage. Two-process architecture: a backend daemon handles Gmail sync, LLM processing, and storage; a TUI client communicates via REST API.

**MVP scope:** AI-generated summaries, unified search (semantic + filter operators), efficient keyboard-driven browsing, archive/delete actions. Bulk triage deferred to follow-on.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Backend Daemon (Bun)            │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Gmail    │  │ LLM      │  │ Embedding  │ │
│  │ Sync     │  │ Summarize│  │ Indexer    │ │
│  │ Service  │  │ Service  │  │ Service    │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘ │
│       │              │              │        │
│  ┌────▼──────────────▼──────────────▼──────┐ │
│  │         SQLite + sqlite-vec             │ │
│  └─────────────────────────────────────────┘ │
│       │                                     │
│  ┌────▼──────────┐                          │
│  │ REST API      │                          │
│  │ (Hono)        │                          │
│  └───────────────┘                          │
└─────────────────────────────────────────────┘
         │ HTTP (localhost)
┌────────▼────────┐
│  TUI (OpenTUI)  │
└─────────────────┘
```

## Backend Daemon

### Technology

- **Runtime:** Bun
- **HTTP:** Hono
- **Database:** SQLite via `bun:sqlite`, vector search via `sqlite-vec`
- **Gmail:** Gmail API with adapter pattern for testability

### Authorization (OAuth 2.0)

Gmail API requires OAuth 2.0. The app uses the standard desktop app flow:

**Setup (one-time):**
1. User creates a project in Google Cloud Console, enables the Gmail API
2. Creates OAuth 2.0 credentials (desktop app type), downloads as `credentials.json`
3. Places `credentials.json` at the configured path (default `~/.gmail-sweep/credentials.json`)

**First run:**
1. TUI detects no authorization (via `GET /auth/status`)
2. TUI displays the authorization URL (from `GET /auth/url`) in the status bar
3. User opens the URL in their browser and grants permissions
4. Google redirects to a local callback endpoint (`http://localhost:{port}/auth/callback`)
5. Backend exchanges auth code for access + refresh tokens
6. Tokens saved to `token.json`
7. TUI polls `GET /auth/status` and updates display when authorized

**Subsequent runs:**
- Access token refreshed automatically using the refresh token
- No user interaction needed unless refresh token is revoked

**Required Gmail scopes:**
- `https://www.googleapis.com/auth/gmail.readonly` — read emails and labels
- `https://www.googleapis.com/auth/gmail.modify` — archive, delete, mark read/unread

The TUI displays auth status in the status bar. If auth fails or tokens expire, the user is prompted to re-authorize.

### Gmail Adapter

```typescript
interface GmailAdapter {
  listMessages(options: { maxResults: number, pageToken?: string, labelIds?: string[] }): Promise<{
    messages: GmailMessage[]
    nextPageToken?: string
    resultSizeEstimate?: number
    historyId: string
  }>
  listHistory(startHistoryId: string): Promise<{
    history: HistoryRecord[]  // added/deleted/labelChanged message IDs
    historyId: string          // new cursor for next call
  }>
  getMessage(id: string): Promise<GmailMessage>
  archive(id: string): Promise<void>
  delete(id: string): Promise<void>
  modifyLabels(id: string, addLabels?: string[], removeLabels?: string[]): Promise<void>
  listLabels(): Promise<GmailLabel[]>
}
```

Production uses the real Gmail API adapter. Tests inject a mock with canned responses.

### REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/auth/url` | Get Google OAuth consent URL for manual browser visit |
| GET | `/auth/callback` | OAuth callback — exchange auth code for tokens |
| GET | `/auth/status` | Auth status (authorized, email) |
| GET | `/emails` | List emails (paginated, filterable by label, read status) |
| GET | `/emails/:id` | Single email with AI summary |
| POST | `/emails/:id/archive` | Archive email |
| POST | `/emails/:id/delete` | Delete email |
| POST | `/emails/:id/read` | Mark read |
| POST | `/emails/:id/unread` | Mark unread |
| POST | `/sync?batchSize=N` | Trigger Gmail fetch — returns 202 immediately, sync runs in background |
| GET | `/sync/status` | Sync state, historyId position, gap count, worker queue depth, `sync_in_progress` flag |
| GET | `/sync/gaps` | List open gaps with pageToken cursors and estimated counts |
| POST | `/sync/gaps/:id/fill` | Fill a specific gap using its pageToken |
| DELETE | `/sync/gaps/:id` | Abandon a gap |
| POST | `/search` | Unified search (semantic + operator filters) |
| GET | `/status` | Backend health |

### Worker Pipeline

After fetching emails from Gmail, the backend triggers a sequential worker pipeline:

1. **LLM Summary Worker** — picks emails where `ai_status = 'pending'`, generates structured summary
2. **Embedding Worker** — picks emails where `embedding IS NULL` and `ai_status = 'done'`, generates vector embedding from subject + summary text

Embedding depends on summary completion because it embeds `subject + summary` rather than raw body. This gives better semantic search quality (summarized, distilled content) but creates a pipeline dependency. Results stored back in SQLite.

### Sync & Gap Management

The backend uses two complementary Gmail mechanisms:

1. **Incremental sync (new mail)** — `history.list` + `historyId`. Gmail's recommended approach for detecting new/changed/deleted messages since last sync. Avoids all timestamp boundary problems.
2. **Historical backfill (gaps)** — `messages.list` + `pageToken`. When the initial sync doesn't fetch the full mailbox, stored `pageToken` cursors resume pagination exactly where it left off.

**Sync state data model:**

```sql
sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,  -- singleton row
  last_history_id TEXT,               -- for history.list incremental sync
  last_sync_at INTEGER                -- informational timestamp
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

Key design decisions:
- `page_token` is Gmail's own stable cursor — no timestamp boundary issues, no day-granularity limitations.
- `estimated_count` is informational only for UI display. Gap closure is determined by the **absence of `nextPageToken`** in the API response, never by comparing counts.
- `sync_state` is a singleton row tracking the `historyId` for incremental sync.

**Sync flow for `POST /sync?batchSize=100`:**

1. **Incremental sync (if `last_history_id` exists):**
   a. Call `history.list(startHistoryId)` for changes since last sync
   b. Fetch full content for newly added message IDs
   c. Apply deletions and label changes to local DB
   d. Update `sync_state.last_history_id`
   e. If `history.list` returns 404 (historyId expired, ~30 day window), fall through to step 2
2. **Full sync (if no `last_history_id` or it expired):**
   a. Call `messages.list(maxResults=batchSize, labelIds=['INBOX'])` — only fetch inbox emails
   b. Store `historyId` from response into `sync_state`
   c. If `nextPageToken` exists, create a gap with that pageToken
3. **Gap fill (if open gaps exist and batch budget remains):**
   a. Pick highest-priority open gap
   b. Call `messages.list(pageToken=gap.page_token)` — pageToken already encodes the original query context
   c. If response has `nextPageToken`, update gap's `page_token`
   d. If response has no `nextPageToken`, close the gap — all historical messages reached
   e. Dedup: skip any message IDs already in the local DB (`INSERT OR IGNORE`)
4. Store all fetched emails, trigger summary/embedding workers

**Concurrency control:**

- Gap fill uses SQLite's atomic row-level check-and-set: `UPDATE gaps SET status = 'filling' WHERE id = ? AND status = 'open'`. If 0 rows affected, another sync is already filling that gap.
- `POST /sync` returns **202 Accepted** immediately and runs the sync as an async background task. It does not block the HTTP response.
- An in-memory mutex prevents concurrent syncs — if a sync is already in progress, `POST /sync` returns **409 Conflict**.
- `GET /sync/status` includes a `sync_in_progress` boolean flag so the TUI can poll for completion.

**Mutation handling:**

All email mutations (archive, delete, read/unread) use **confirm-then-remove** semantics:

1. Call the Gmail API first
2. Only apply the local DB change after the API confirms success
3. If the API call fails, return the error to the TUI — local state remains unchanged

This guarantees local and remote state never diverge. No outbox, no retry queue, no tombstone table needed.

Combined with INBOX-only sync (`labelIds=['INBOX']`), archived emails (INBOX label removed on Gmail) and deleted emails (moved to TRASH) won't reappear on subsequent syncs.

### Search

Unified search parses a single query string into SQL filters and a semantic vector query.

**Parsing logic:**

- Operator tokens (`from:`, `before:`, `after:`, `subject:`, `label:`, `is:unread`, `is:read`, `has:actions`, `has:no-actions`) → SQL WHERE clauses
- Remaining free text → embedded → vector similarity search
- No free text → pure SQL filter query, no embeddings

**Supported operators:**

| Operator | Example | SQL filter |
|----------|---------|------------|
| `from:` | `from:sarah@` | `WHERE sender LIKE '%sarah@%'` |
| `to:` | `to:team@` | `WHERE recipients LIKE '%team@%'` |
| `subject:` | `subject:Q1` | `WHERE subject LIKE '%Q1%'` |
| `before:` | `before:2026/03/25` | `WHERE date_received < '2026-03-25'` |
| `after:` | `after:2026/03/01` | `WHERE date_received > '2026-03-01'` |
| `label:` | `label:Finance` | `WHERE EXISTS (SELECT 1 FROM json_each(labels) WHERE json_extract(value, '$.name') = 'Finance')` |
| `is:unread` | `is:unread` | `WHERE is_read = false` |
| `is:read` | `is:read` | `WHERE is_read = true` |
| `has:actions` | `has:actions` | `WHERE json_array_length(action_items) > 0` |
| `has:no-actions` | `has:no-actions` | `WHERE json_array_length(action_items) = 0` |

**API:**

```
POST /search
{
  "query": "from:rj@kolbegger.com before:2026/03/25 party invitation",
  "limit": 50
}

Backend:
  1. Parse operators → SQL filters
  2. Extract free text → embed → vector search
  3. Combine: SQL filters narrow candidates, vector similarity ranks them
  4. Return ranked results
```

## Data Model

```sql
emails (
  id TEXT PRIMARY KEY,              -- Gmail message ID
  thread_id TEXT,                   -- Gmail thread ID
  sender TEXT,
  recipients TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  date_sent TIMESTAMP,
  date_received TIMESTAMP,
  labels TEXT,                      -- JSON array: [{"id":"Label_1","name":"Finance"}]
  is_read BOOLEAN,
  is_starred BOOLEAN,
  fetched_at TIMESTAMP,
  -- AI fields (nullable until processed)
  summary TEXT,                     -- One sentence, no filler
  action_items TEXT,                -- JSON array of strings
  key_points TEXT,                  -- JSON array of strings
  summary_model TEXT,
  summary_generated_at TIMESTAMP,
  embedding BLOB,                   -- raw Float32Array for reference only
  embedding_model TEXT,
  embedding_generated_at TIMESTAMP,
  ai_status TEXT DEFAULT 'pending'  -- 'pending' | 'processing' | 'done' | 'failed'
)

sync_state (...)
gaps (...)
```

### Vector Search (sqlite-vec)

Embeddings are stored in a separate `sqlite-vec` virtual table, not as a BLOB on the emails table. This enables ANN (approximate nearest neighbor) index-based search.

**Virtual table DDL:**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_emails USING vec0(
  email_id TEXT PRIMARY KEY,
  embedding float[1024]
);
```

**Key parameters:**
- **Dimension:** 1024 (BGE-M3 output dimension)
- **Distance metric:** cosine similarity (sqlite-vec default)

**Lifecycle:**
- Created at DB initialization alongside other tables
- Row inserted when embedding worker generates a vector for an email
- Row deleted when an email is removed from the emails table (cascade)
- `embedding BLOB` on the emails table is kept as a redundant copy for debugging/inspection only — the virtual table is the source of truth for search

**Filtered search strategy:**
1. SQL filters narrow candidates (get matching email IDs)
2. Vector similarity ranks the candidates via join against `vec_emails`
3. If no free text in query, skip vector search entirely (pure SQL)

```sql
SELECT e.*, v.distance
FROM emails e
JOIN vec_emails v ON v.email_id = e.id
WHERE {sql_filters}
  AND v.embedding MATCH ?
ORDER BY v.distance
LIMIT ?
```

LLM generates a structured summary per email:

- **Summary:** One sentence describing the email contents. No filler phrases like "This email describes" or "The sender writes."
- **Action Items:** Bullet list of concrete actions the recipient should take. Empty array if none.
- **Key Points:** Bullet list of important information from the email.

The LLM prompt forces JSON output matching this structure. `action_items` and `key_points` are stored as JSON arrays for queryability.

## TUI Client

### Technology

- **Framework:** OpenTUI (TypeScript)
- **Runtime:** Bun

### Layout

Two-panel vertical split (Option A from design review):

```
┌─ Inbox (142 unread) ──────────────────┬─ AI Summary ──────────────────────────┐
│ ▸ ● Sarah Chen  Re: Q1 Planning       │ From: sarah.chen@company.com           │
│   10:42 AM                             │ Subject: Re: Q1 Planning Update        │
│                                        │ Date: Mar 28, 10:42 AM                 │
│   ▸  ○ Jira        SERVER-4521 is now  │                                        │
│   10:15 AM                             │ Sarah proposes moving Q1 review to     │
│                                        │ Apr 2nd due to CEO scheduling conflict.│
│   ▸  ○ Mike Ross   Lunch tomorrow?     │                                        │
│   9:48 AM                              │ Action Items:                          │
│                                        │ • Confirm date change                  │
│   ▸ ● AWS Billing Your invoice is rea..│ • Update calendar invite               │
│   9:30 AM                              │ • Book conf room for Apr 2             │
│                                        │                                        │
│   ▸  ○ GitHub      PR #342 merged      │ Key Points:                            │
│   9:12 AM                              │ • CEO confirmed for Apr 2nd            │
│                                        │ • Decision needed by EOD Friday        │
│   ▸  ○ LinkedIn    New connection re..  │ • Original date was Mar 30             │
│   8:55 AM                              │                                        │
│                                        │ ──── original email ────               │
│   ▸  ○ Figma       Design review fo..  │ Hi, I was thinking it might be...      │
│   8:30 AM                              │                                        │
├────────────────────────────────────────────────────────────────────────────────┤
│ j/k: navigate  e: archive  #: delete  Tab: summary/full  /: search  s: sync   │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

- **Pane-based, not popup-based.** The detail panel renders summary and full email inline as scrollable text. No floating boxes, no borders-within-borders.
- **Search is the exception** — it expands a bar at the bottom (replacing the keybinding hint temporarily).
- **Clean and minimal.** Content fills the pane naturally.

### Detail Panel

`Enter` toggles between two layouts:

1. **Two-panel view** (default): Email list on the left, detail panel on the right
2. **Full-width detail view**: Inbox list hidden, detail panel takes the full window. Press `Enter` again to restore the two-panel view.

`Tab` toggles the detail panel content between two modes:

1. **Summary mode** (default): Shows AI summary, action items, key points. If not yet generated, shows placeholder text ("Summary not yet generated. Worker is processing...").
2. **Full email mode**: Shows the raw email text, scrollable.

### Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate email list up/down |
| `Enter` | Toggle layout: two-panel view ↔ full-width detail panel |
| `Tab` | Toggle detail panel content: summary ↔ full text |
| `e` | Archive selected email |
| `#` | Delete selected email |
| `r` | Toggle read/unread |
| `/` | Enter search mode |
| `Esc` | Exit search / cancel |
| `s` | Trigger manual sync |
| `q` | Quit |

### Search Mode

When `/` is pressed, the status bar transforms into a search input. `Esc` or empty `Enter` returns to normal mode. Results replace the email list.

## Configuration

```toml
# config.toml

[server]
host = "127.0.0.1"
port = 45731

[gmail]
credentials_path = "~/.gmail-sweep/credentials.json"
token_path = "~/.gmail-sweep/token.json"

[llm]
# Three example configurations — uncomment one:

# 1. Anthropic (claude-sonnet-4.6)
# provider = "anthropic"
# base_url = "https://api.anthropic.com"
# api_key = "sk-ant-..."
# summary_model = "claude-sonnet-4-6"

# 2. OpenAI (gpt-5.3)
# provider = "openai"
# base_url = "https://api.openai.com"
# api_key = "sk-..."
# summary_model = "gpt-5.3"

# 3. LMStudio (local, qwen3.5-35b-a3b)
# provider = "openai"
# base_url = "http://192.168.4.31:5006"
# api_key = "local-dev"
# summary_model = "qwen3.5-35b-a3b"

embedding_model = "BAAI/bge-m3"
embedding_dimension = 1024

[sync]
default_batch_size = 100
auto_sync_on_startup = true
poll_interval_seconds = 300

[ui]
theme = "tokyo-night"
```

### Provider Abstraction

The `provider` field determines which adapter is used: `"anthropic"` targets the Anthropic Messages API, `"openai"` targets the OpenAI Chat Completions API. Both share the same adapter interfaces:

```typescript
interface LLMProvider {
  summarize(email: Email): Promise<{
    summary: string
    actionItems: string[]
    keyPoints: string[]
  }>
}

interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>
}
```

The default config targets LMStudio locally. Changing `base_url`, `api_key`, and model names switches to any compatible provider.

## Error Handling

- **Gmail API errors:** Exponential backoff on sync, show sync status in TUI status bar, don't crash
- **Mutation failures:** Confirm-then-remove — if Gmail API call fails, return error to TUI, local state unchanged
- **LLM errors:** Mark email `ai_status = 'failed'`, retry on next sync cycle, show "summary unavailable" in detail panel
- **Network errors:** Show connection indicator in status bar, mutations fail gracefully (user sees error, can retry)
- **DB errors:** Fatal — log and exit with clear message

## Testing

### Development Practice: TDD

All code is written using strict test-driven development:

1. **Red** — Write failing test(s) against a stubbed implementation
2. **Green** — Implement the minimum code to make all tests pass
3. **Refactor** — Look for refactoring opportunities in both code and tests
4. **Proceed** — Any failing tests must be corrected before moving to the next work item

This applies to every layer: backend services, REST endpoints, search parsing, gap management, and TUI components.

### Unit Tests

- Search query parsing (operator extraction, filter building)
- Gap management logic (creation, consolidation, priority ordering)
- LLM prompt formatting and response parsing

### Integration Tests

- SQLite + sqlite-vec with test emails in temp directories
- REST API endpoints via Bun's test runner
- Full backend stack with mock Gmail adapter (no real network calls)

### TUI Tests via tmux

Automated integration tests that use tmux as a terminal harness. Tests spin up a real TUI process, send keystrokes, capture screen output, and assert — all via `bun test`, no manual steps.

**Test harness:**

```typescript
// test/helpers/tui-harness.ts
class TuiSession {
  private sessionId: string

  static async start(backendUrl: string): Promise<TuiSession> {
    const id = `test-${Date.now()}`
    execSync(`tmux new-session -d -s ${id} -x 200 -y 50 './gmail-sweep --backend ${backendUrl}'`)
    // Wait for initial render
    await sleep(500)
    return new TuiSession(id)
  }

  async sendKeys(keys: string): Promise<void> {
    execSync(`tmux send-keys -t ${this.sessionId} '${keys}'`)
    await sleep(100) // wait for render
  }

  async captureScreen(): Promise<string> {
    return execSync(`tmux capture-pane -t ${this.sessionId} -p`).toString()
  }

  async cleanup(): Promise<void> {
    execSync(`tmux kill-session -t ${this.sessionId}`)
  }
}
```

**Test example:**

```typescript
// test/tui/navigation.test.ts
test("j/k navigates email list", async () => {
  const backend = await startMockBackend()
  const tui = await TuiSession.start(backend.url)

  const initial = await tui.captureScreen()
  await tui.sendKeys("j")
  const afterDown = await tui.captureScreen()
  expect(afterDown).not.toBe(initial)

  await tui.sendKeys("k")
  const afterUp = await tui.captureScreen()
  expect(afterUp).toBe(initial)

  await tui.cleanup()
  await backend.cleanup()
})
```

**TUI test scenarios:**
- Email list navigation (j/k)
- Archive/delete updates list correctly
- Search mode entry/exit/query
- Detail panel toggle (summary ↔ full text)
- Sync trigger and status display
- Error states (no connection, no emails)

All TUI tests run against the backend with a mock Gmail adapter. Full stack minus external services.
