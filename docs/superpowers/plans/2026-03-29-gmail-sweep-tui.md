# Gmail Sweep TUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TUI Gmail client with AI summaries and semantic search, delivered as vertical slices.

**Architecture:** Two-process design — backend daemon (Bun + Hono + SQLite) serves REST API, TUI client (OpenTUI) consumes it. Mock Gmail adapter for all tests. TDD at every step.

**Tech Stack:** Bun, TypeScript, Hono, SQLite + sqlite-vec, OpenTUI, tmux (TUI tests)

---

## File Structure

```
gmail-sweep/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── config.toml
├── src/
│   ├── backend/
│   │   ├── index.ts                 # Backend entry point
│   │   ├── server.ts                # Hono app setup
│   │   ├── config.ts                # TOML config loader
│   │   ├── db/
│   │   │   ├── index.ts             # DB init + connection
│   │   │   └── schema.ts            # Table creation DDL
│   │   ├── gmail/
│   │   │   ├── adapter.ts           # GmailAdapter interface
│   │   │   ├── gmail-api.ts         # Real Gmail API client
│   │   │   └── mock.ts              # Mock adapter for tests
│   │   ├── auth/
│   │   │   ├── oauth.ts             # OAuth 2.0 flow
│   │   │   └── token-store.ts       # Token persistence
│   │   ├── services/
│   │   │   ├── sync.ts              # Email sync service
│   │   │   ├── gap-manager.ts       # Gap tracking + fill (pageToken-based)
│   │   │   ├── summary-worker.ts    # LLM summary worker
│   │   │   ├── embedding-worker.ts  # Embedding worker
│   │   │   └── search.ts            # Unified search service
│   │   ├── routes/
│   │   │   ├── status.ts            # GET /status
│   │   │   ├── auth.ts              # OAuth callback routes
│   │   │   ├── emails.ts            # Email CRUD + action routes
│   │   │   ├── sync.ts              # Sync + gap routes
│   │   │   └── search.ts            # Search route
│   │   └── llm/
│   │       ├── provider.ts          # LLMProvider + EmbeddingProvider interfaces
│   │       ├── openai-adapter.ts    # OpenAI-compatible adapter
│   │       ├── anthropic-adapter.ts # Anthropic-compatible adapter
│   │       └── prompt.ts            # Summary prompt template
│   └── tui/
│       ├── index.ts                  # TUI entry point
│       ├── app.ts                    # Main app, keybinding routing
│       ├── components/
│       │   ├── email-list.ts         # Left panel: email list
│       │   ├── detail-panel.ts       # Right panel: summary/full email
│       │   ├── search-bar.ts         # Search input bar
│       │   └── status-bar.ts         # Bottom: keybinding hints + status
│       ├── api.ts                    # REST client for backend
│       └── theme.ts                  # Color theme constants
├── test/
│   ├── helpers/
│   │   ├── tui-harness.ts           # tmux TUI test harness
│   │   ├── mock-backend.ts          # Mock backend for TUI tests
│   │   └── test-db.ts               # Temp SQLite helper
│   ├── backend/
│   │   ├── config.test.ts
│   │   ├── db.test.ts
│   │   ├── oauth.test.ts
│   │   ├── token-store.test.ts
│   │   ├── gmail-adapter.test.ts
│   │   ├── sync.test.ts
│   │   ├── gap-manager.test.ts
│   │   ├── summary-worker.test.ts
│   │   ├── embedding-worker.test.ts
│   │   ├── search-parser.test.ts
│   │   ├── search.test.ts
│   │   └── routes/
│   │       ├── status.test.ts
│   │       ├── auth.test.ts
│   │       ├── emails.test.ts
│   │       ├── sync.test.ts
│   │       └── search.test.ts
│   └── tui/
│       ├── startup.test.ts
│       ├── navigation.test.ts
│       ├── detail-toggle.test.ts
│       ├── email-actions.test.ts
│       ├── search.test.ts
│       └── sync-status.test.ts
```

---

## Slice 1: Project Scaffolding + Config

**Deliverable:** Runnable project skeleton. Backend starts HTTP server, responds to health check. TUI starts, connects to backend, shows connection status. Config loads from TOML file.

### Task 1.1: Project initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `.gitignore` (update existing)

- [ ] **Initialize Bun project, install dependencies**

```bash
bun init
bun add hono smol-toml
bun add -d @types/bun sqlite-vec
```

**Note on sqlite-vec:** The `sqlite-vec` native extension is loaded at runtime via `bun:sqlite`'s loadExtension API. The npm package provides the precompiled `.so`/`.dylib`. See sqlite-vec docs for platform-specific setup.

**Note on OpenTUI:** Install when implementing Slice 3 (TUI). Package name TBD — check OpenTUI docs for current package name and installation instructions.

- [ ] **Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@backend/*": ["./src/backend/*"],
      "@tui/*": ["./src/tui/*"],
      "@test/*": ["./test/*"]
    }
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Update .gitignore**

```
node_modules/
dist/
.superpowers/
*.db
*.db-journal
config.toml
credentials.json
token.json
```

- [ ] **Commit**

```bash
git add package.json tsconfig.json bunfig.toml .gitignore bun.lock
git commit -m "chore: initialize bun project with dependencies"
```

### Task 1.2: Config loader

**Files:**
- Create: `src/backend/config.ts`
- Create: `config.example.toml`
- Create: `test/backend/config.test.ts`

```typescript
describe('Config loader', () => {
  it('should load config from a TOML file')
  it('should apply default values for missing optional fields')
  it('should throw with a clear message if required fields are missing')
  it('should expand ~ in file paths to the home directory')
  it('should validate server port is a number between 1 and 65535')
  it('should validate sync.batch_size is a positive integer')
})
```

- [ ] **Write failing tests** → implement config.ts → green → commit

### Task 1.3: Database initialization

**Files:**
- Create: `src/backend/db/index.ts`
- Create: `src/backend/db/schema.ts`
- Create: `test/helpers/test-db.ts`
- Create: `test/backend/db.test.ts`

Initial schema — basic emails table only (no AI columns, no sync_state/gaps yet):

```sql
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
```

```typescript
describe('Database initialization', () => {
  it('should create the emails table on first run')
  it('should not fail if tables already exist (idempotent)')
  it('should create indexes on date_received, is_read, and thread_id')
})
```

- [ ] **Write failing tests** → implement db/index.ts + schema.ts → green → commit

### Task 1.4: Backend HTTP server + health endpoint

**Files:**
- Create: `src/backend/server.ts`
- Create: `src/backend/routes/status.ts`
- Create: `src/backend/index.ts`
- Create: `test/backend/routes/status.test.ts`

```typescript
describe('GET /status', () => {
  it('should return 200 with status ok')
  it('should include the server version')
  it('should include database status (connected or error)')
})
```

- [ ] **Write failing tests** → implement server.ts + routes/status.ts + index.ts → green → commit

### Task 1.5: TUI skeleton + backend connection

**Files:**
- Create: `src/tui/index.ts`
- Create: `src/tui/app.ts`
- Create: `src/tui/api.ts`
- Create: `src/tui/theme.ts`
- Create: `test/helpers/tui-harness.ts`
- Create: `test/helpers/mock-backend.ts`
- Create: `test/tui/startup.test.ts`

TUI shows a centered message "Connected to backend" or "Cannot reach backend" based on GET /status response. Minimal OpenTUI setup.

```typescript
describe('TUI startup', () => {
  it('should display a connected message when backend is reachable')
  it('should display an error message when backend is unreachable')
  it('should quit when q is pressed')
})
```

- [ ] **Write failing tests** → implement tui/index.ts + app.ts + api.ts + theme.ts → green → commit

- [ ] **Slice 1 commit**

```bash
git add src/ test/
git commit -m "feat: project scaffolding with config, db, health endpoint, and TUI skeleton"
```

---

## Slice 2: OAuth Authorization

**Deliverable:** User can authorize the app with Gmail. Backend handles full OAuth flow (credentials → browser consent → callback → token storage). TUI displays auth status. Token refresh works automatically.

**DB note:** Wipe database before manual testing (schema unchanged, but clean state preferred).

### Task 2.1: Token store

**Files:**
- Create: `src/backend/auth/token-store.ts`
- Create: `test/backend/token-store.test.ts`

```typescript
describe('TokenStore', () => {
  describe('save', () => {
    it('should persist access_token, refresh_token, and expiry to a JSON file')
    it('should create the directory if it does not exist')
  })

  describe('load', () => {
    it('should load tokens from the JSON file')
    it('should return null if the file does not exist')
    it('should throw with a clear message if the file is malformed JSON')
  })

  describe('isExpired', () => {
    it('should return true if expiry time has passed')
    it('should return false if expiry time has not passed')
    it('should return true if no tokens are loaded')
  })
})
```

### Task 2.2: OAuth flow

**Files:**
- Create: `src/backend/auth/oauth.ts`
- Create: `test/backend/oauth.test.ts`

```typescript
describe('OAuth flow', () => {
  describe('getAuthorizationUrl', () => {
    it('should build a Google OAuth URL with client_id, redirect_uri, scope, and state')
    it('should include PKCE code_challenge and code_challenge_method')
    it('should generate and store a random state parameter')
    it('should include all required Gmail scopes (readonly, modify)')
  })

  describe('exchangeCode', () => {
    it('should POST to Google token endpoint with code, client_id, client_secret, redirect_uri, and code_verifier')
    it('should return access_token, refresh_token, and expiry on success')
    it('should throw on invalid authorization code')
    it('should throw on mismatched state parameter')
  })

  describe('refreshAccessToken', () => {
    it('should POST to Google token endpoint with grant_type=refresh_token')
    it('should return new access_token and expiry')
    it('should throw on invalid refresh token')
  })

  describe('getValidToken', () => {
    it('should return existing token if not expired')
    it('should refresh and return new token if expired')
    it('should return null if no tokens exist (user not authorized)')
  })
})
```

### Task 2.3: OAuth routes

**Files:**
- Create: `src/backend/routes/auth.ts`
- Create: `test/backend/routes/auth.test.ts`

```typescript
describe('OAuth routes', () => {
  describe('GET /auth/url', () => {
    it('should return the Google authorization URL')
    it('should return 503 if credentials.json is not configured')
  })

  describe('GET /auth/callback', () => {
    it('should exchange the code for tokens and save them')
    it('should return 400 if state parameter does not match')
    it('should return 400 if code is missing')
    it('should return 200 with success message on valid callback')
  })

  describe('GET /auth/status', () => {
    it('should return authorized=true when valid tokens exist')
    it('should return authorized=false when no tokens exist')
  })
})
```

### Task 2.4: Gmail adapter interface + mock

**Files:**
- Create: `src/backend/gmail/adapter.ts`
- Create: `src/backend/gmail/mock.ts`
- Create: `test/backend/gmail-adapter.test.ts`

Define the GmailAdapter interface (from spec). Mock adapter returns canned responses.

```typescript
describe('Mock Gmail adapter', () => {
  it('should return a preset list of messages from listMessages')
  it('should return historyId from listMessages')
  it('should return a specific message from getMessage')
  it('should track archive calls and remove INBOX label')
  it('should track delete calls and add TRASH label')
  it('should track modifyLabels calls with add and remove lists')
  it('should return preset labels from listLabels')
  it('should return history records from listHistory')
  it('should return a new historyId from listHistory')
})
```

### Task 2.5: TUI auth status display

**Files:**
- Create: `src/tui/components/status-bar.ts`
- Modify: `src/tui/app.ts`
- Create: `test/tui/auth-status.test.ts`

TUI polls GET /auth/status and shows "Not authorized — visit http://localhost:{port}/auth/url" or "Authorized as {email}" in the status bar.

```typescript
describe('TUI auth status', () => {
  it('should display authorization instructions when not authorized')
  it('should display authorized status when tokens exist')
  it('should update status when authorization is completed in another terminal')
})
```

- [ ] **Slice 2 commit**

```bash
git add src/ test/
git commit -m "feat: OAuth authorization flow with token management and TUI auth status"
```

---

## Slice 3: Email Sync + Browse

**Deliverable:** User can trigger email sync. Backend fetches newest emails from Gmail and stores them. TUI shows a two-panel layout: email list (left) + full email text (right). j/k navigation. No gap handling. No AI summaries.

**DB note:** Wipe database before manual testing — emails table schema finalized.

### Task 3.1: Gmail API client

**Files:**
- Create: `src/backend/gmail/gmail-api.ts`
- Create: `test/backend/gmail-api.test.ts`

Implements GmailAdapter using the real Gmail API. Uses OAuth token store for auth headers. All tests mock `fetch` via Bun's `mock()` — no real network calls.

```typescript
describe('Gmail API client', () => {
  describe('listMessages', () => {
    it('should call GET /gmail/v1/users/me/messages with maxResults')
    it('should include pageToken when provided')
    it('should return message list, nextPageToken, and historyId')
    it('should throw on 401 with a clear auth error')
    it('should retry on 429 with exponential backoff')
    it('should retry on 500/503 with exponential backoff')
  })

  describe('listHistory', () => {
    it('should call GET /gmail/v1/users/me/history with startHistoryId')
    it('should return history records with added/deleted/labelChanged message IDs')
    it('should return a new historyId for the next incremental sync')
    it('should throw on 404 when historyId has expired')
  })

  describe('getMessage', () => {
    it('should call GET /gmail/v1/users/me/messages/{id} with format=full')
    it('should parse headers into from, to, subject, date fields')
    it('should extract text/plain and text/html body parts')
    it('should decode base64 body content')
  })

  describe('archive', () => {
    it('should call POST /gmail/v1/users/me/messages/{id}/modify removing INBOX label')
  })

  describe('delete', () => {
    it('should call POST /gmail/v1/users/me/messages/{id}/modify adding TRASH label')
  })

  describe('modifyLabels', () => {
    it('should call POST /gmail/v1/users/me/messages/{id}/modify with add and remove label lists')
  })

  describe('listLabels', () => {
    it('should call GET /gmail/v1/users/me/labels and return label list')
  })
})
```

### Task 3.2: Email sync service (basic — no gaps)

**Files:**
- Create: `src/backend/services/sync.ts`
- Create: `test/backend/sync.test.ts`

Basic sync: fetch newest N emails, upsert into SQLite. Store `historyId` for incremental sync. If `nextPageToken` present, create a gap. No gap filling yet. No workers triggered.

```typescript
describe('Sync service (basic)', () => {
  describe('syncNewest', () => {
    it('should fetch batchSize emails from Gmail via messages.list with labelIds=[INBOX]')
    it('should upsert fetched emails into the database')
    it('should skip emails already in the database')
    it('should store labels as JSON with id and name')
    it('should return the count of newly fetched emails')
    it('should return the count of skipped (already stored) emails')
    it('should store historyId from the Gmail response into sync_state')
    it('should create a gap with nextPageToken if Gmail returns one')
    it('should not create a gap when Gmail returns no nextPageToken')
    it('should handle Gmail API errors gracefully without crashing')
  })

  describe('syncIncremental', () => {
    it('should call history.list with stored last_history_id')
    it('should fetch full content for newly added message IDs')
    it('should apply deletions from history to local DB')
    it('should apply label changes from history to local DB')
    it('should update sync_state.last_history_id after successful sync')
    it('should fall back to full messages.list if historyId is expired (404)')
    it('should handle history.list returning no changes')
  })

  describe('getSyncStatus', () => {
    it('should return total stored email count')
    it('should return unread email count')
    it('should return last_history_id from sync_state')
  })
})
```

### Task 3.3: Email routes

**Files:**
- Create: `src/backend/routes/emails.ts`
- Create: `test/backend/routes/emails.test.ts`

```typescript
describe('Email routes', () => {
  describe('GET /emails', () => {
    it('should return a paginated list of emails ordered by date_received desc')
    it('should support a limit query parameter (default 50)')
    it('should support an offset query parameter')
    it('should support filtering by is_read (unread=true/false)')
    it('should support filtering by label name')
    it('should not false-match on label substrings')
    it('should return id, sender, subject, date_received, is_read, is_starred per email')
    it('should return total count in a response header or metadata field')
  })

  describe('GET /emails/:id', () => {
    it('should return full email details including body_text')
    it('should return 404 for non-existent email')
  })
})
```

### Task 3.4: Sync routes (basic)

**Files:**
- Create: `src/backend/routes/sync.ts`
- Create: `test/backend/routes/sync.test.ts`

```typescript
describe('Sync routes (basic)', () => {
  describe('POST /sync', () => {
    it('should return 202 immediately and run sync in background')
    it('should trigger incremental sync if last_history_id exists')
    it('should trigger full sync if no last_history_id exists')
    it('should accept batchSize query parameter')
    it('should return 401 if not authorized')
    it('should return 409 if a sync is already in progress')
  })

  describe('GET /sync/status', () => {
    it('should return total stored count, unread count, last_history_id, and sync_in_progress flag')
  })
})
```

### Task 3.5: TUI two-panel layout + email list

**Files:**
- Create: `src/tui/components/email-list.ts`
- Create: `src/tui/components/detail-panel.ts`
- Modify: `src/tui/components/status-bar.ts`
- Modify: `src/tui/app.ts`
- Create: `test/tui/navigation.test.ts`

```typescript
describe('TUI email list navigation', () => {
  it('should display email list with sender, subject, and time')
  it('should highlight the currently selected email')
  it('should show unread indicator for unread emails')
  it('should move selection down when j is pressed')
  it('should move selection up when k is pressed')
  it('should not move selection above the first email')
  it('should scroll the list when selection moves beyond visible area')
  it('should show unread count in the panel header')
})
```

### Task 3.6: TUI detail panel (full email only)

**Files:**
- Modify: `src/tui/components/detail-panel.ts`
- Create: `test/tui/detail-panel.test.ts`

Detail panel shows full email text (body_text) only. No summary view yet — that comes in Slice 6.

`Enter` toggles layout: two-panel (inbox list + detail) ↔ full-width detail (inbox list hidden). `j`/`k` still navigates the selected email even in full-width mode.

```typescript
describe('TUI detail panel', () => {
  it('should display sender, subject, and date when an email is selected')
  it('should display the email body text')
  it('should update when a different email is selected')
  it('should show a placeholder message when no email is selected')
  it('should scroll long emails')
  it('should hide inbox list and expand detail to full width when Enter is pressed')
  it('should restore two-panel view when Enter is pressed again')
  it('should still respond to j/k navigation in full-width detail mode')
})
```

- [ ] **Slice 3 commit**

```bash
git add src/ test/
git commit -m "feat: email sync and two-panel browse layout with j/k navigation"
```

---

## Slice 4: Email Actions

**Deliverable:** User can archive (e), delete (#), and toggle read/unread (r) from the TUI. Actions propagate to Gmail via the backend. Email list updates immediately.

### Task 4.1: Email action routes

**Files:**
- Modify: `src/backend/routes/emails.ts`
- Modify: `test/backend/routes/emails.test.ts`

```typescript
describe('Email action routes', () => {
  describe('POST /emails/:id/archive', () => {
    it('should call gmailAdapter.archive with the email id')
    it('should remove the email from the local database only after Gmail confirms success')
    it('should not remove the email from local DB if Gmail archive call fails')
    it('should return 200 on success')
    it('should return 404 if email does not exist locally')
    it('should return 502 if Gmail API call fails')
  })

  describe('POST /emails/:id/delete', () => {
    it('should call gmailAdapter.delete with the email id')
    it('should remove the email from the local database only after Gmail confirms success')
    it('should not remove the email from local DB if Gmail delete call fails')
    it('should return 200 on success')
  })

  describe('POST /emails/:id/read', () => {
    it('should call gmailAdapter.modifyLabels removing UNREAD')
    it('should set is_read = true in the local database only after Gmail confirms success')
    it('should not update is_read locally if Gmail modifyLabels call fails')
    it('should return 200 on success')
  })

  describe('POST /emails/:id/unread', () => {
    it('should call gmailAdapter.modifyLabels adding UNREAD')
    it('should set is_read = false in the local database only after Gmail confirms success')
    it('should not update is_read locally if Gmail modifyLabels call fails')
    it('should return 200 on success')
  })
})
```

### Task 4.2: TUI archive, delete, and read/unread keybindings

**Files:**
- Modify: `src/tui/app.ts`
- Modify: `src/tui/components/email-list.ts`
- Create: `test/tui/email-actions.test.ts`

```typescript
describe('TUI email actions', () => {
  describe('archive (e key)', () => {
    it('should remove the selected email from the list when e is pressed')
    it('should select the next email after archiving')
    it('should select the previous email if archiving the last email')
    it('should show an empty state if all emails are archived')
  })

  describe('delete (# key)', () => {
    it('should remove the selected email from the list when # is pressed')
    it('should select the next email after deleting')
  })

  describe('read/unread toggle (r key)', () => {
    it('should toggle the unread indicator when r is pressed')
    it('should update the unread count in the panel header')
    it('should maintain the current selection after toggling')
  })
})
```

- [ ] **Slice 4 commit**

```bash
git add src/ test/
git commit -m "feat: archive, delete, and read/unread actions with TUI keybindings"
```

---

## Slice 5: Gap Management

**Deliverable:** Backend tracks sync gaps, fills them when batch capacity allows. User can trigger sync with `s` and see gap status. Newest emails always fetched first; gap fill uses leftover capacity.

**DB note:** Wipe database before manual testing — adds sync_state and gaps tables.

### Task 5.1: Gap manager service

**Files:**
- Create: `src/backend/services/gap-manager.ts`
- Create: `test/backend/gap-manager.test.ts`

```typescript
describe('Gap manager', () => {
  describe('createGap', () => {
    it('should create a gap with the pageToken from Gmail API response')
    it('should store estimated_count as informational only')
    it('should set status to open')
  })

  describe('getNextGapToFill', () => {
    it('should return the oldest open gap (first created, deepest in history)')
    it('should return null if no open gaps exist')
    it('should skip gaps with status filling')
  })

  describe('fillGap', () => {
    it('should atomically set gap status to filling (skip if already filling)')
    it('should call messages.list with the gap pageToken')
    it('should close the gap when response has no nextPageToken')
    it('should update gap page_token when response has nextPageToken')
    it('should dedup via INSERT OR IGNORE when fetched messages already exist locally')
    it('should return gap to open status if fill fails partway through')
    it('should never use resultSizeEstimate for gap closure decisions')
  })

  describe('abandonGap', () => {
    it('should set gap status to closed')
    it('should return 404 if gap does not exist')
  })
})
```

### Task 5.2: Enhanced sync with gap fill

**Files:**
- Modify: `src/backend/services/sync.ts`
- Modify: `src/backend/db/schema.ts` (add sync_state + gaps tables)
- Modify: `test/backend/sync.test.ts`

```typescript
describe('Enhanced sync with gaps', () => {
  describe('POST /sync flow', () => {
    it('should run incremental sync via history.list when last_history_id exists')
    it('should fall back to full messages.list when historyId is expired')
    it('should use remaining batch capacity for gap fill')
    it('should create a gap with nextPageToken from initial messages.list')
    it('should not attempt gap fill when there is no remaining capacity')
    it('should prevent concurrent syncs (return 409 if sync in progress)')
  })

  describe('gap fill', () => {
    it('should fill the oldest open gap first (deepest in history)')
    it('should update gap page_token when partial fill')
    it('should close gap when no nextPageToken returned')
    it('should handle concurrent sync calls without double-filling the same gap')
  })
})
```

### Task 5.3: Gap routes

**Files:**
- Modify: `src/backend/routes/sync.ts`
- Modify: `test/backend/routes/sync.test.ts`

```typescript
describe('Gap routes', () => {
  describe('GET /sync/status', () => {
    it('should include gap count and total estimated gap emails')
    it('should include last_history_id from sync_state')
    it('should include summary worker queue depth (ai_status = pending)')
    it('should include embedding worker queue depth (ai_status = done, embedding IS NULL)')
  })

  describe('GET /sync/gaps', () => {
    it('should list all open gaps sorted by created_at asc (oldest first)')
    it('should include page_token, estimated_count, and status for each gap')
  })

  describe('POST /sync/gaps/:id/fill', () => {
    it('should trigger a fill for the specified gap using its pageToken')
    it('should return 404 if gap does not exist')
    it('should return 409 if gap is already in filling status')
  })

  describe('DELETE /sync/gaps/:id', () => {
    it('should abandon the specified gap')
    it('should return 404 if gap does not exist')
  })
})
```

### Task 5.4: TUI sync status and sync trigger

**Files:**
- Modify: `src/tui/components/status-bar.ts`
- Modify: `src/tui/app.ts`
- Create: `test/tui/sync-status.test.ts`

```typescript
describe('TUI sync status', () => {
  it('should display last sync time in the status bar')
  it('should show syncing... indicator when sync is in progress')
  it('should trigger sync when s is pressed')
  it('should show sync result (new emails count) after sync completes')
  it('should show gap count in the status bar')
  it('should update status bar after sync completes')
  it('should show sync error when POST /sync returns 409 (already in progress)')
})
```

- [ ] **Slice 5 commit**

```bash
git add src/ test/
git commit -m "feat: gap management with historyId incremental sync, pageToken backfill, and TUI sync status"
```

---

## Slice 6: AI Summaries

**Deliverable:** Backend generates structured AI summaries for synced emails. TUI detail panel shows summary by default, with Tab to toggle full email text. Summary worker processes pending emails in the background.

**DB note:** Wipe database before manual testing — adds AI columns to emails table.

### Task 6.1: LLM provider interface + adapters

**Files:**
- Create: `src/backend/llm/provider.ts`
- Create: `src/backend/llm/openai-adapter.ts`
- Create: `src/backend/llm/anthropic-adapter.ts`
- Create: `test/backend/llm/openai-adapter.test.ts`
- Create: `test/backend/llm/anthropic-adapter.test.ts`

```typescript
describe('OpenAI-compatible LLM provider', () => {
  describe('summarize', () => {
    it('should POST to {base_url}/v1/chat/completions with the configured model')
    it('should include the email content in the user message')
    it('should parse the response into summary, actionItems, and keyPoints')
    it('should throw on non-200 response')
    it('should throw on malformed JSON response')
    it('should handle empty action_items and key_points arrays')
  })
})

describe('Anthropic LLM provider', () => {
  describe('summarize', () => {
    it('should POST to {base_url}/v1/messages with the configured model')
    it('should include the email content in the user message')
    it('should parse the response into summary, actionItems, and keyPoints')
    it('should throw on non-200 response')
    it('should throw on malformed JSON response')
    it('should handle empty action_items and key_points arrays')
  })
})
```

### Task 6.2: Summary prompt template

**Files:**
- Create: `src/backend/llm/prompt.ts`
- Create: `test/backend/llm/prompt.test.ts`

```typescript
describe('Summary prompt', () => {
  it('should include the system prompt defining the output format')
  it('should request a one-sentence summary with no filler')
  it('should request action items as a JSON array of strings')
  it('should request key points as a JSON array of strings')
  it('should force JSON output format')
  it('should include the email sender, subject, and body in the user message')
})
```

### Task 6.3: Summary worker

**Files:**
- Create: `src/backend/services/summary-worker.ts`
- Create: `test/backend/summary-worker.test.ts`

```typescript
describe('Summary worker', () => {
  describe('processPending', () => {
    it('should query emails with ai_status = pending')
    it('should set ai_status to processing before calling the LLM')
    it('should store summary, action_items, key_points, and model name on success')
    it('should set ai_status to done on success')
    it('should set ai_status to failed on LLM error')
    it('should continue processing remaining emails after a single failure')
    it('should process emails concurrently up to a configurable limit')
    it('should not process emails already in processing status')
  })

  describe('getQueueDepth', () => {
    it('should return count of emails with ai_status = pending')
  })

  describe('lifecycle', () => {
    it('should shut down gracefully when the server stops')
    it('should not start duplicate worker loops')
    it('should resume processing after a crash without skipping or duplicating emails')
  })
})
```

### Task 6.4: Update email schema + routes for AI data

**Files:**
- Modify: `src/backend/db/schema.ts` (add AI columns to emails)
- Modify: `src/backend/routes/emails.ts`
- Modify: `test/backend/routes/emails.test.ts`

```typescript
describe('Email routes with AI data', () => {
  describe('GET /emails/:id', () => {
    it('should include summary, action_items, and key_points when ai_status is done')
    it('should include ai_status field')
    it('should return null summary fields when ai_status is pending')
    it('should return null summary fields when ai_status is failed')
  })

  describe('GET /emails', () => {
    it('should include ai_status in the list response')
  })
})
```

### Task 6.5: TUI detail panel summary/full toggle

**Files:**
- Modify: `src/tui/components/detail-panel.ts`
- Modify: `src/tui/app.ts` (Tab keybinding)
- Modify: `test/tui/detail-panel.test.ts`

```typescript
describe('TUI detail panel summary toggle', () => {
  it('should show AI summary by default when summary is available')
  it('should show one-sentence summary')
  it('should show action items as a bulleted list')
  it('should show key points as a bulleted list')
  it('should show placeholder text when summary is not yet generated')
  it('should switch to full email text when Tab is pressed')
  it('should switch back to summary when Tab is pressed again')
  it('should indicate current mode (summary/full) in the panel')
})
```

### Task 6.6: Trigger summary worker after sync

**Files:**
- Modify: `src/backend/services/sync.ts` (trigger worker after sync)
- Modify: `src/backend/index.ts` (start background worker loop)

After sync completes (basic + gap fill), trigger summary worker on newly fetched emails. Also start a background loop that processes pending summaries periodically.

- [ ] **Slice 6 commit**

```bash
git add src/ test/
git commit -m "feat: AI summaries with LLM worker and TUI summary/full toggle"
```

---

## Slice 7: Unified Search

**Deliverable:** User can press `/` to enter search mode, type a query with operators and free text, and see results ranked by relevance. Backend handles operator parsing, embedding generation, and vector similarity search.

**DB note:** Wipe database before manual testing — adds embedding column.

### Task 7.1: Search query parser

**Files:**
- Create: `src/backend/services/search-parser.ts`
- Create: `test/backend/search-parser.test.ts`

```typescript
describe('Search query parser', () => {
  describe('operator extraction', () => {
    it('should extract from: operator')
    it('should extract to: operator')
    it('should extract subject: operator')
    it('should extract before: operator and parse the date')
    it('should extract after: operator and parse the date')
    it('should extract label: operator')
    it('should extract is:unread operator')
    it('should extract is:read operator')
    it('should extract has:actions operator')
    it('should extract has:no-actions operator')
    it('should extract multiple operators from a single query')
  })

  describe('free text extraction', () => {
    it('should return remaining text after removing operators as the semantic query')
    it('should return empty semantic query when only operators are present')
    it('should handle operators embedded within phrases (only extract at token start)')
  })

  describe('filter building', () => {
    it('should build SQL WHERE clauses from extracted operators')
    it('should combine multiple filters with AND')
    it('should use LIKE for from: (sender), to: (recipients), subject: operators')
    it('should use date comparison for before: and after: operators')
    it('should use json_each() to query json_extract for value, '$.name') = labels array)
    it('should use json_array_length for has:actions and has:no-actions operators')
  })
})
```

### Task 7.2: Embedding provider + worker

**Files:**
- Create: `src/backend/services/embedding-worker.ts`
- Modify: `src/backend/llm/provider.ts` (add EmbeddingProvider interface)
- Modify: `src/backend/llm/openai-compat.ts` (add embed method)
- Create: `test/backend/embedding-worker.test.ts`

```typescript
describe('Embedding worker', () => {
  describe('processPending', () => {
    it('should query emails where embedding IS NULL and ai_status = done')
    it('should generate embeddings for email subject + summary')
    it('should insert embedding into vec_emails virtual table')
    it('should store embedding BLOB on emails table as redundant copy')
    it('should store embedding_model and embedding_generated_at')
    it('should continue after a single embedding failure')
    it('should process concurrently up to a configurable limit')
  })
})
```

### Task 7.3: Vector search service

**Files:**
- Create: `src/backend/services/search.ts`
- Create: `test/backend/search.test.ts`

```typescript
describe('Search service', () => {
  describe('search', () => {
    it('should embed the free text query and search by vector similarity')
    it('should apply SQL filters before vector search to narrow candidates')
    it('should return pure SQL results when no free text is provided')
    it('should return results ranked by similarity score descending')
    it('should respect the limit parameter')
    it('should return similarity score with each result')
    it('should exclude emails without embeddings from vector search')
  })

  describe('sqlite-vec virtual table', () => {
    it('should create vec_emails with float[1024] on DB init')
    it('should insert embeddings into vec_emails when generated')
    it('should delete embeddings from vec_emails when emails are removed')
    it('should handle searches when no emails have embeddings yet')
    it('should handle searches when some but not all filtered emails have embeddings')
  })
})
```

### Task 7.4: Search route

**Files:**
- Create: `src/backend/routes/search.ts`
- Create: `test/backend/routes/search.test.ts`

```typescript
describe('POST /search', () => {
  it('should accept a query string and return matched emails')
  it('should return results ordered by relevance')
  it('should support the limit parameter (default 50)')
  it('should return 400 if query is empty')
  it('should handle operator-only queries without vector search')
})
```

### Task 7.5: TUI search mode

**Files:**
- Create: `src/tui/components/search-bar.ts`
- Modify: `src/tui/app.ts`
- Create: `test/tui/search.test.ts`

```typescript
describe('TUI search mode', () => {
  it('should activate search bar when / is pressed')
  it('should show a search input prompt in the status bar area')
  it('should execute search when Enter is pressed')
  it('should replace the email list with search results')
  it('should restore the original email list when Esc is pressed')
  it('should restore the original email list when search is empty and Enter is pressed')
  it('should allow j/k navigation of search results')
  it('should allow archive/delete actions on search results')
  it('should show a no results message when search returns empty')
})
```

- [ ] **Slice 7 commit**

```bash
git add src/ test/
git commit -m "feat: unified search with operator parsing, embeddings, and TUI search mode"
```

---

## Slice 8: Polish

**Deliverable:** Auto-polling for new email. Error indicators in status bar. Exponential backoff on Gmail API failures. Clean theme. Robust error handling throughout.

### Task 8.1: Auto-polling

**Files:**
- Modify: `src/backend/index.ts`
- Create: `test/backend/auto-poll.test.ts`

```typescript
describe('Auto-polling', () => {
  it('should trigger sync at the configured poll interval')
  it('should not trigger overlapping syncs')
  it('should not trigger sync when not authorized')
  it('should be disabled when poll_interval_seconds is 0')
})
```

### Task 8.2: Error handling in status bar

**Files:**
- Modify: `src/tui/components/status-bar.ts`
- Modify: `src/tui/api.ts`
- Create: `test/tui/error-indicators.test.ts`

```typescript
describe('TUI error indicators', () => {
  it('should show connection error when backend is unreachable')
  it('should show auth error when tokens are invalid or revoked')
  it('should show sync error when Gmail API returns an error')
  it('should clear error indicator when the issue is resolved')
  it('should show worker queue depth (pending summaries / embeddings)')
})
```

### Task 8.3: Theme support

**Files:**
- Modify: `src/tui/theme.ts`
- Create: `test/tui/theme.test.ts`

```typescript
describe('Theme', () => {
  it('should load the configured theme by name')
  it('should apply tokyo-night theme colors as default')
  it('should throw with a clear message for unknown theme names')
  it('should define colors for: background, foreground, accent, muted, error, success')
})
```

- [ ] **Slice 8 commit**

```bash
git add src/ test/
git commit -m "feat: auto-polling, error indicators, and theme support"
```

---

## Spec Coverage Check

| Spec Section | Slice |
|---|---|
| OAuth 2.0 | Slice 2 |
| Gmail Adapter | Slice 2 (interface), Slice 3 (implementation) |
| REST Endpoints — emails | Slice 3 |
| REST Endpoints — email actions | Slice 4 |
| REST Endpoints — sync | Slice 3 (basic), Slice 5 (gaps) |
| REST Endpoints — search | Slice 7 |
| REST Endpoints — status | Slice 1 |
| Worker Pipeline — summaries | Slice 6 |
| Worker Pipeline — embeddings | Slice 7 |
| Sync & Gap Management | Slice 3 (basic), Slice 5 (gaps) |
| Search — operator parsing | Slice 7 |
| Search — vector similarity | Slice 7 |
| Data Model — emails | Slice 3 (basic), Slice 6 (AI fields) |
| Data Model — sync_state, gaps | Slice 5 |
| AI Summary Format | Slice 6 |
| TUI Layout — two panel | Slice 3 |
| TUI Detail Panel — summary toggle | Slice 6 |
| TUI Keybindings — j/k | Slice 3 |
| TUI Keybindings — e, #, r | Slice 4 |
| TUI Keybindings — / search | Slice 7 |
| TUI Keybindings — s sync | Slice 5 |
| TUI Keybindings — q quit | Slice 1 |
| Configuration | Slice 1 |
| Provider Abstraction | Slice 6 (LLM), Slice 7 (embedding) |
| Error Handling | Slice 8 |
| Testing — unit | All slices |
| Testing — integration | All slices |
| Testing — TUI via tmux | Slices 1–7 |
