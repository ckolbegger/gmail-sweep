# Bun OpenTUI Gmail Client v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Bun/Hono/OpenTUI Gmail client described in `docs/superpowers/specs/2026-05-03-bun-opentui-gmail-client-v1-design.md`.

**Architecture:** Use a Bun workspace with shared types, a Hono backend, an OpenTUI React terminal client, provider interfaces for Gmail/AI, and per-account `bun:sqlite` storage under `~/.gmail-sweep/`. Build in vertical slices that prove real Gmail/AI behavior early, while deterministic automated tests use fake providers and temp app data.

**Tech Stack:** Bun, TypeScript, Hono, OpenTUI React, `bun:sqlite`, Google Gmail API, OpenAI SDK, Anthropic SDK, `html-to-text`, tmux.

---

## Non-Negotiable Constraints

- Do not inspect, read, copy, or use files from Claude, GLM, or any non-Codex worktree.
- No web client in v1.
- No permanent Gmail delete in v1; Trash only.
- No mutation confirmations and no undo.
- Commit local durable mutation state only after Gmail confirms success.
- If real-service acceptance is blocked by missing credentials, missing `gmail-sweep-test` label, or missing test messages, stop and ask the user whether to proceed.
- Each deliverable ends with a tmux acceptance test of the actual TUI. Fake-provider tmux tests may supplement but do not replace real-service acceptance for Gmail/AI features.

## Implementation Decisions

- Use `U` to toggle all vs unread-only.
- Use `B` to open bounded backfill.
- Use `html-to-text` behind `packages/backend/src/content/html-to-text.ts`; if Bun compatibility fails, replace only that adapter.
- Use Bun subprocess APIs in `packages/tui/src/backend-process.ts` to start/stop only the backend process launched by the TUI.
- Use `GMAIL_SWEEP_HOME` in tests/acceptance to isolate app data from the user's real `~/.gmail-sweep/`.
- Require a Gmail label named `gmail-sweep-test` for real-service acceptance. Acceptance helpers validate it before tests run.

## Planned File Structure

```text
package.json
bun.lock
tsconfig.base.json
.gitignore

packages/shared/
  package.json
  tsconfig.json
  src/api.ts
  src/config.ts
  src/email.ts
  src/provider.ts
  src/search.ts
  src/sync.ts
  src/summary.ts

packages/backend/
  package.json
  tsconfig.json
  src/index.ts
  src/app.ts
  src/config/paths.ts
  src/config/load.ts
  src/db/connection.ts
  src/db/schema.ts
  src/db/repositories/*.ts
  src/providers/gmail/types.ts
  src/providers/gmail/fake.ts
  src/providers/gmail/google.ts
  src/providers/ai/types.ts
  src/providers/ai/fake.ts
  src/providers/ai/openai.ts
  src/providers/ai/anthropic.ts
  src/content/mime.ts
  src/content/html-to-text.ts
  src/content/extract.ts
  src/sync/baseline.ts
  src/sync/history.ts
  src/sync/backfill.ts
  src/sync/queue.ts
  src/summaries/worker.ts
  src/search/parser.ts
  src/search/local.ts
  src/routes/*.ts
  src/dev/scenarios.ts

packages/tui/
  package.json
  tsconfig.json
  src/index.tsx
  src/backend-process.ts
  src/api-client.ts
  src/state/controller.ts
  src/state/keymap.ts
  src/views/App.tsx
  src/views/InboxView.tsx
  src/views/MessagePreview.tsx
  src/views/MessageDetail.tsx
  src/views/SearchInput.tsx
  src/views/BackfillPrompt.tsx
  src/views/HelpOverlay.tsx

tests/unit/
tests/integration/
tests/tui/
scripts/acceptance/
  README.md
  run-tmux.ts
  check-real-prereqs.ts
  deliverable-*.ts
```

## Acceptance Tests To Track Up Front

- [ ] **A1 Provider probes:** Run TUI in tmux, start backend, complete/status-check Gmail auth, verify `gmail-sweep-test` label exists, list tiny test-label batch, run configured AI probe.
- [ ] **A2 Baseline sync:** Run TUI in tmux, sync a tiny Inbox/test-label baseline from real Gmail, inspect newest-first list and detail body.
- [ ] **A3 Body extraction and summaries:** Run TUI in tmux, open test-label messages, toggle `Tab`, verify real AI summary appears, next-message prefetch status advances, and HTML-only/bad-plaintext fallback extraction is verified or explicitly BLOCKED.
- [ ] **A4 Mutations:** Run TUI in tmux, mutate only `gmail-sweep-test` messages, verify Gmail-confirmed local DB state after archive, Trash, read/unread, star, important; restore where possible.
- [ ] **A5 History sync:** Run TUI in tmux, modify/create real test-label messages externally or via guarded helper, sync, verify history changes apply and cursor status is honest. Use fake scenario for hundreds-message backlog.
- [ ] **A6 Search/labels/ergonomics:** Run TUI in tmux against real cached test-label messages, verify local body search, operator search, Gmail system label rendering, `U`, `[`, `]`, `?`.
- [ ] **A7 Bounded backfill:** Run TUI in tmux, choose scope, accept default `1` day, verify bounded real backfill or stop for user decision if safe setup is missing.
- [ ] **A8 Hardening:** Run final tmux smoke with real providers plus fake scenarios for rate limits, restart/resume, and failures.

## Chunk 1: Workspace, Shared Types, Config, Dev Mode, Provider Probes

### Task 1.1: Scaffold Bun Workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/tui/package.json`
- Create: `packages/tui/tsconfig.json`

- [ ] **Step 1: Write workspace manifests**

Create root scripts:

```json
{
  "name": "gmail-sweep",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration",
    "test:tui": "bun test tests/tui",
    "backend": "bun run packages/backend/src/index.ts",
    "tui": "bun run packages/tui/src/index.tsx"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Add package dependencies**

Run:

```bash
bun add hono googleapis openai @anthropic-ai/sdk html-to-text
bun add @opentui/react @opentui/core
bun add -d @types/html-to-text
```

Expected: dependencies added to root workspace lockfile. If package names have changed, stop and verify current OpenTUI docs before substituting.

- [ ] **Step 3: Add `.gitignore` entries**

Include:

```gitignore
node_modules/
.env
.gmail-sweep-test/
.superpowers/
```

Keep existing entries.

- [ ] **Step 4: Verify workspace skeleton**

Run:

```bash
bun install
bun test
```

Expected: install succeeds; tests report no tests or pass.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock tsconfig.base.json .gitignore packages
git commit -m "chore: scaffold Bun workspace"
```

### Task 1.2: Define Shared Contracts

**Files:**
- Create: `packages/shared/src/email.ts`
- Create: `packages/shared/src/summary.ts`
- Create: `packages/shared/src/sync.ts`
- Create: `packages/shared/src/config.ts`
- Create: `packages/shared/src/provider.ts`
- Create: `packages/shared/src/search.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/index.ts`
- Test: `tests/unit/shared_types.test.ts`

- [ ] **Step 1: Write type compile test**

Create `tests/unit/shared_types.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Email, EmailSummary, SyncStatus } from "../../packages/shared/src";

test("shared types expose v1 email contract", () => {
  const summary: EmailSummary = { description: "d", actionItems: [], keyPoints: [] };
  const email: Email = {
    id: "m1",
    threadId: "t1",
    subject: "Subject",
    from: "sender@example.com",
    to: ["me@example.com"],
    cc: [],
    bcc: [],
    date: "2026-05-03T00:00:00.000Z",
    snippet: "snippet",
    labels: ["INBOX", "UNREAD"],
    system: { unread: true, inbox: true, trash: false, spam: false, sent: false, draft: false, starred: false, important: false, category: null },
    userLabels: [],
    bodyText: "body",
    bodyHtml: null,
    bodyAudit: { source: "text/plain", reason: "plain-text-present" },
    summary,
    summaryStatus: "complete"
  };
  const status: SyncStatus = { mode: "idle", totalMessages: 1, pendingHydration: 0, pendingHistory: 0, stale: false };
  expect(email.summary?.description).toBe("d");
  expect(status.stale).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/unit/shared_types.test.ts
```

Expected: FAIL because shared exports do not exist.

- [ ] **Step 3: Implement minimal shared types**

Define literal unions for summary status, body audit source/reason, system label state, sync status, backfill job, provider mode, and API request/response shapes matching the spec.

- [ ] **Step 4: Run test**

Run:

```bash
bun test tests/unit/shared_types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared tests/unit/shared_types.test.ts
git commit -m "feat: add shared v1 contracts"
```

### Task 1.3: Implement Config Paths And Loading

**Files:**
- Create: `packages/backend/src/config/paths.ts`
- Create: `packages/backend/src/config/load.ts`
- Test: `tests/unit/config_paths.test.ts`
- Test: `tests/unit/config_load.test.ts`

- [ ] **Step 1: Write tests**

Cover:

- `GMAIL_SWEEP_HOME` overrides `~/.gmail-sweep`.
- account DB path is `accounts/<account-id>/mail.sqlite`.
- default `sync.maxMessagesPerFetch` is `100`.
- AI config stores provider/model and env var names, not required raw secrets.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/config_paths.test.ts tests/unit/config_load.test.ts
```

Expected: FAIL because config modules do not exist.

- [ ] **Step 3: Implement config modules**

Implement:

```ts
export function getAppHome(env = process.env): string
export function getConfigPath(home: string): string
export function getAccountsPath(home: string): string
export function getAccountDir(home: string, accountId: string): string
export function loadConfig(env = process.env): AppConfig
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/config_paths.test.ts tests/unit/config_load.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config tests/unit/config_* package.json bun.lock
git commit -m "feat: add app config loading"
```

### Task 1.4: Backend Health And Provider Probe Interfaces

**Files:**
- Create: `packages/backend/src/app.ts`
- Create: `packages/backend/src/index.ts`
- Create: `packages/backend/src/providers/gmail/types.ts`
- Create: `packages/backend/src/providers/gmail/fake.ts`
- Create: `packages/backend/src/providers/ai/types.ts`
- Create: `packages/backend/src/providers/ai/fake.ts`
- Create: `packages/backend/src/routes/status.ts`
- Create: `packages/backend/src/routes/providers.ts`
- Test: `tests/integration/backend_status.test.ts`
- Test: `tests/integration/provider_probe_fake.test.ts`

- [ ] **Step 1: Write integration tests**

Use Hono `app.request()` to assert:

- `GET /status` returns `{ ok: true, providerMode }`.
- fake Gmail probe returns account/test-label metadata.
- fake AI probe returns deterministic success.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/backend_status.test.ts tests/integration/provider_probe_fake.test.ts
```

Expected: FAIL because backend modules do not exist.

- [ ] **Step 3: Implement minimal Hono app and fake providers**

Fake Gmail should include a `gmail-sweep-test` label and seeded messages. Fake AI returns a fixed summary.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/backend_status.test.ts tests/integration/provider_probe_fake.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend tests/integration/backend_status.test.ts tests/integration/provider_probe_fake.test.ts
git commit -m "feat: add backend health and fake provider probes"
```

### Task 1.5: Real Gmail OAuth And Probe Skeleton

**Files:**
- Create: `packages/backend/src/providers/gmail/google.ts`
- Create: `packages/backend/src/routes/auth.ts`
- Modify: `packages/backend/src/routes/providers.ts`
- Test: `tests/integration/auth_routes_fake.test.ts`
- Create: `scripts/acceptance/check-real-prereqs.ts`

- [ ] **Step 1: Write fake auth route tests**

Assert `/auth/status` reports unauthenticated with no token, `/auth/start` returns an auth URL in fake/dev mode, and callback stores a fake account token in a temp home.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/auth_routes_fake.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement auth routes and Google provider shell**

Real provider requirements:

- read `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
- start loopback callback;
- auto-open browser via platform command when possible;
- print URL fallback;
- store tokens in the active account directory;
- request `https://mail.google.com/`.
- implement bounded real probe methods for profile, labels, and a tiny Inbox/test-label message list;
- route `/providers/gmail/probe` must call those real methods when real mode is configured and return PASS or BLOCKED with exact reason.

Do not run real OAuth in automated tests.

- [ ] **Step 4: Implement prereq checker**

`scripts/acceptance/check-real-prereqs.ts` should check:

- Google env vars exist;
- at least one AI provider env var exists for configured provider;
- active account can authenticate or reports a clear blocked reason;
- `gmail-sweep-test` label exists;
- test label has at least one message for read-only acceptance.

- [ ] **Step 5: Run tests**

```bash
bun test tests/integration/auth_routes_fake.test.ts
bun run scripts/acceptance/check-real-prereqs.ts --dry-run
```

Expected: tests PASS; prereq checker reports PASS or BLOCKED with exact missing items.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/providers/gmail/google.ts packages/backend/src/routes/auth.ts packages/backend/src/routes/providers.ts tests/integration/auth_routes_fake.test.ts scripts/acceptance/check-real-prereqs.ts
git commit -m "feat: add Gmail auth and real prereq checks"
```

### Task 1.6: Real AI Provider Probes

**Files:**
- Create: `packages/backend/src/providers/ai/openai.ts`
- Create: `packages/backend/src/providers/ai/anthropic.ts`
- Modify: `packages/backend/src/routes/providers.ts`
- Test: `tests/integration/ai_probe_fake.test.ts`

- [ ] **Step 1: Write fake route test for configured provider selection**

Assert fake provider works and provider errors are surfaced as `{ ok: false, reason }`.

- [ ] **Step 2: Run test to verify failure or missing behavior**

```bash
bun test tests/integration/ai_probe_fake.test.ts
```

Expected: FAIL if provider selection/probe behavior is missing.

- [ ] **Step 3: Implement OpenAI and Anthropic probe methods**

Each real probe sends one tiny deterministic request only when credentials are configured. Missing credentials return blocked status rather than throwing.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/ai_probe_fake.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/providers/ai packages/backend/src/routes/providers.ts tests/integration/ai_probe_fake.test.ts
git commit -m "feat: add AI provider probes"
```

### Task 1.7: TUI Boot Shell Starts Backend

**Files:**
- Create: `packages/tui/src/backend-process.ts`
- Create: `packages/tui/src/api-client.ts`
- Create: `packages/tui/src/index.tsx`
- Create: `packages/tui/src/views/App.tsx`
- Create: `tests/tui/backend_process.test.ts`
- Create: `scripts/acceptance/run-tmux.ts`
- Create: `scripts/acceptance/deliverable-1.ts`

- [ ] **Step 1: Write backend process tests**

Test that the supervisor:

- returns existing backend if `/status` responds;
- starts backend if missing;
- stops only the process it started.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/backend_process.test.ts
```

Expected: FAIL because backend supervisor does not exist.

- [ ] **Step 3: Implement TUI shell**

Show backend status, provider mode, auth status, and key hints. Include a setup-screen action, `p`, that calls the backend Gmail and AI probe endpoints through the TUI and renders PASS or BLOCKED results. Use OpenTUI React primitives only.

- [ ] **Step 4: Implement tmux runner**

`run-tmux.ts` should create a named session, run a command, send keys, capture pane text, assert expected text, and always clean up the session.

- [ ] **Step 5: Run automated tests**

```bash
bun test tests/tui/backend_process.test.ts
```

- [ ] **Step 6: Run A1 tmux acceptance**

```bash
bun run scripts/acceptance/deliverable-1.ts
```

Expected:

- TUI boots in tmux.
- Backend starts if absent.
- Acceptance sends `p` in the actual TUI and verifies the TUI calls real Gmail and AI probe endpoints when real providers are configured.
- Real provider probes PASS or BLOCKED with exact reason; static/fake status alone cannot satisfy A1.
- If BLOCKED, stop for user decision before proceeding.

- [ ] **Step 7: Commit**

```bash
git add packages/tui scripts/acceptance tests/tui
git commit -m "feat: add TUI boot and provider acceptance"
```

## Chunk 2: Storage And Baseline Sync

### Task 2.1: SQLite Schema And Repositories

**Files:**
- Create: `packages/backend/src/db/connection.ts`
- Create: `packages/backend/src/db/schema.ts`
- Create: `packages/backend/src/db/repositories/emails.ts`
- Create: `packages/backend/src/db/repositories/sync-state.ts`
- Create: `packages/backend/src/db/repositories/queues.ts`
- Test: `tests/unit/db_schema.test.ts`
- Test: `tests/integration/email_repository.test.ts`

- [ ] **Step 1: Write schema/repository tests**

Cover:

- tables are created in a temp DB;
- email upsert stores full body fields and labels;
- sync state stores committed history ID and pending counts;
- per-account DB path comes from config paths.
- two active accounts open separate SQLite files;
- messages inserted for one account never appear in another account;
- repository factory opens only the configured active account DB.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/db_schema.test.ts tests/integration/email_repository.test.ts
```

- [ ] **Step 3: Implement schema**

Tables:

- `emails`
- `email_headers`
- `sync_state`
- `history_changes`
- `hydration_queue`
- `backfill_jobs`
- `summary_queue`

Keep schema minimal but include fields required by the spec.

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/db_schema.test.ts tests/integration/email_repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/db tests/unit/db_schema.test.ts tests/integration/email_repository.test.ts
git commit -m "feat: add SQLite storage"
```

### Task 2.2: Gmail Provider Message Listing And Hydration

**Files:**
- Modify: `packages/backend/src/providers/gmail/types.ts`
- Modify: `packages/backend/src/providers/gmail/fake.ts`
- Modify: `packages/backend/src/providers/gmail/google.ts`
- Test: `tests/integration/gmail_provider_fake.test.ts`

- [ ] **Step 1: Write fake provider tests**

Assert:

- list by Inbox/test label returns IDs and page tokens;
- hydrate returns full message payload with labels, headers, text, and HTML;
- fake scenario can include unread/starred/important/category labels.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/gmail_provider_fake.test.ts
```

- [ ] **Step 3: Implement provider methods**

Interface methods:

```ts
listMessages(scope, pageToken, maxResults)
getMessage(id)
getProfile()
listLabels()
```

Google implementation wraps Gmail API but keeps raw API objects inside provider layer.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/gmail_provider_fake.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/providers/gmail tests/integration/gmail_provider_fake.test.ts
git commit -m "feat: add Gmail listing and hydration provider"
```

### Task 2.3: Baseline Sync Service And Routes

**Files:**
- Create: `packages/backend/src/sync/baseline.ts`
- Create: `packages/backend/src/routes/sync.ts`
- Create: `packages/backend/src/routes/emails-read.ts`
- Modify: `packages/backend/src/app.ts`
- Test: `tests/integration/baseline_sync.test.ts`
- Test: `tests/integration/email_read_routes.test.ts`

- [ ] **Step 1: Write baseline sync tests**

Test fake baseline:

- captures starting history marker;
- hydrates at most `maxMessagesPerFetch`;
- stores full messages;
- records labels/status;
- exposes `/sync/status`;
- exposes `GET /emails` and `GET /emails/:id` for read-only list/detail;
- does not mark baseline complete until all queued IDs hydrate.
- stores the baseline history marker as pending/uncommitted until history replay applies covered changes in Chunk 5; do not write it as the committed cursor in this chunk.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/baseline_sync.test.ts tests/integration/email_read_routes.test.ts
```

- [ ] **Step 3: Implement service and routes**

Routes:

- `POST /sync`
- `GET /sync/status`
- `GET /emails`
- `GET /emails/:id`

Keep current slice list-based. History replay comes in Chunk 5. Store the captured baseline marker separately from `committed_history_id` so the app cannot claim the cursor is safe before replay runs.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/baseline_sync.test.ts tests/integration/email_read_routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/sync packages/backend/src/routes/sync.ts packages/backend/src/routes/emails-read.ts packages/backend/src/app.ts tests/integration/baseline_sync.test.ts tests/integration/email_read_routes.test.ts
git commit -m "feat: add baseline sync"
```

### Task 2.4: Inbox List And Detail TUI

**Files:**
- Create: `packages/tui/src/state/controller.ts`
- Create: `packages/tui/src/state/keymap.ts`
- Create: `packages/tui/src/views/InboxView.tsx`
- Create: `packages/tui/src/views/MessagePreview.tsx`
- Modify: `packages/tui/src/views/App.tsx`
- Test: `tests/tui/inbox_controller.test.ts`
- Create: `scripts/acceptance/deliverable-2.ts`

- [ ] **Step 1: Write controller tests**

Cover newest-first list, selection movement, unread bold flag in view model, detail loading, and automatic mark-read intent when previewed/opened.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/inbox_controller.test.ts
```

- [ ] **Step 3: Implement controller and views**

Use dense split pane. Do not add web UI. Keep rendering simple and stable.

- [ ] **Step 4: Run tests**

```bash
bun test tests/tui/inbox_controller.test.ts
```

- [ ] **Step 5: Run A2 tmux acceptance**

```bash
bun run scripts/acceptance/deliverable-2.ts
```

Expected: script validates real Gmail prereqs, uses isolated `GMAIL_SWEEP_HOME`, runs the actual TUI in tmux, sends the actual sync key (`r`), and verifies a unique known `gmail-sweep-test` message/body marker displays newest-first. Opening a message shows the full hydrated body text available in this slice. BLOCKED requires user decision.

- [ ] **Step 6: Commit**

```bash
git add packages/tui tests/tui scripts/acceptance/deliverable-2.ts
git commit -m "feat: display synced inbox in TUI"
```

## Chunk 3: MIME Extraction And AI Summaries

### Task 3.1: Body Extraction

**Files:**
- Create: `packages/backend/src/content/mime.ts`
- Create: `packages/backend/src/content/html-to-text.ts`
- Create: `packages/backend/src/content/extract.ts`
- Modify: `packages/shared/src/email.ts`
- Modify: `packages/backend/src/db/schema.ts`
- Modify: `packages/backend/src/db/repositories/emails.ts`
- Modify: `packages/backend/src/sync/baseline.ts`
- Test: `tests/unit/body_extraction.test.ts`

- [ ] **Step 1: Write body extraction tests**

Cases:

- real `text/plain` chosen;
- HTML-only extracts readable text and stores HTML;
- fallback warning plain text is replaced with HTML-derived text;
- audit records source, reason, warning-pattern match, text length, and HTML-derived text length;
- extractor returns `{ bodyText, bodyHtml, audit }`;
- summary input uses canonical `body_text`, never raw HTML or fallback warning text.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/body_extraction.test.ts
```

- [ ] **Step 3: Implement extractor**

Known fallback patterns include:

- "your email client does not support html"
- "this message contains html"
- "view this email in a browser"

Use conservative quality heuristic: replace plain text only when it matches warning patterns or is very short while HTML-derived text has substantial content.

- [ ] **Step 4: Wire extraction into baseline hydration**

Modify baseline sync to store `body_text`, `body_html`, and audit fields.

- [ ] **Step 5: Run tests**

```bash
bun test tests/unit/body_extraction.test.ts tests/integration/baseline_sync.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/content packages/shared/src/email.ts packages/backend/src/db packages/backend/src/sync tests/unit/body_extraction.test.ts tests/integration/baseline_sync.test.ts
git commit -m "feat: extract canonical email body text"
```

### Task 3.2: Summary Providers And Cache

**Files:**
- Create: `packages/backend/src/summaries/worker.ts`
- Create: `packages/backend/src/db/repositories/summaries.ts`
- Create: `packages/backend/src/routes/summaries.ts`
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/providers/ai/*.ts`
- Test: `tests/unit/summary_priority.test.ts`
- Test: `tests/integration/summary_routes.test.ts`

- [ ] **Step 1: Write tests**

Cover:

- selected message has top priority;
- next likely message is queued after selected;
- backfilled messages wait behind newer cached mail;
- rate-limit response pauses worker visibly;
- summary is generated from `body_text`.
- fake/OpenAI/Anthropic providers expose `summarize(bodyText): Promise<EmailSummary>`;
- malformed provider JSON is rejected with a visible failed summary status.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/summary_priority.test.ts tests/integration/summary_routes.test.ts
```

- [ ] **Step 3: Implement summary provider methods, cache, routes, and worker**

Routes:

- `GET /emails/:id/summary`
- `POST /emails/:id/summary`
- `GET /summaries/status`

Provider requirements:

- fake, OpenAI, and Anthropic providers implement `summarize(bodyText): Promise<EmailSummary>`;
- real providers request strict JSON shaped as `EmailSummary`;
- backend validates provider output before caching;
- invalid output marks the summary failed rather than caching bad data.

Mount summary routes in `packages/backend/src/app.ts`. Worker should not cancel active AI calls; it only reprioritizes queued work.

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/summary_priority.test.ts tests/integration/summary_routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/summaries packages/backend/src/routes/summaries.ts packages/backend/src/app.ts packages/backend/src/db/repositories/summaries.ts packages/backend/src/providers/ai tests/unit/summary_priority.test.ts tests/integration/summary_routes.test.ts
git commit -m "feat: add summary cache and worker"
```

### Task 3.3: Summary Toggle And Prefetch In TUI

**Files:**
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/tui/src/views/MessagePreview.tsx`
- Create: `packages/tui/src/views/MessageDetail.tsx`
- Test: `tests/tui/summary_toggle.test.ts`
- Create: `scripts/acceptance/deliverable-3.ts`

- [ ] **Step 1: Write TUI behavior tests**

Cover `Tab` summary/text toggle, lazy summary request, next-message prefetch request, and full-screen detail mode.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/summary_toggle.test.ts
```

- [ ] **Step 3: Implement controller/view behavior**

Show summary loading/error states in preview without blocking navigation.

- [ ] **Step 4: Implement A3 acceptance script**

`deliverable-3.ts` must validate real-service prereqs, run the actual TUI in tmux, open test-label messages, verify `Tab` toggles text/summary, verify prefetch status, and verify an HTML-only or bad-plaintext fallback fixture if available. If the fixture is missing, report BLOCKED for that portion and stop for user decision.

- [ ] **Step 5: Run tests**

```bash
bun test tests/tui/summary_toggle.test.ts
```

- [ ] **Step 6: Run A3 tmux acceptance**

```bash
bun run scripts/acceptance/deliverable-3.ts
```

Expected: real AI summarizes a test-label message; `Tab` toggles summary/text; prefetch status changes for next message; HTML-only/fallback extraction is verified with a real test-label fixture or reports BLOCKED and stops for user decision.

- [ ] **Step 7: Commit**

```bash
git add packages/tui tests/tui/summary_toggle.test.ts scripts/acceptance/deliverable-3.ts
git commit -m "feat: add summary toggle and prefetch UI"
```

## Chunk 4: Gmail Mutations

### Task 4.1: Mutation Provider Methods And Backend Routes

**Files:**
- Modify: `packages/backend/src/providers/gmail/types.ts`
- Modify: `packages/backend/src/providers/gmail/fake.ts`
- Modify: `packages/backend/src/providers/gmail/google.ts`
- Create: `packages/backend/src/routes/emails-mutations.ts`
- Modify: `packages/backend/src/db/repositories/emails.ts`
- Modify: `packages/backend/src/app.ts`
- Test: `tests/integration/email_mutations.test.ts`

- [ ] **Step 1: Write mutation tests**

For archive, Trash, read/unread, star/unstar, important/unimportant:

- Gmail provider method is called;
- DB updates only after provider success;
- provider failure leaves DB unchanged;
- Trash does not permanently delete.
- real provider implementation uses Gmail Trash behavior and never calls permanent delete.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/email_mutations.test.ts
```

- [ ] **Step 3: Implement provider methods and routes**

Use Gmail label modifications except Trash:

- archive: remove `INBOX`;
- trash: real provider must use Gmail `users.messages.trash`; do not call permanent delete;
- read: remove `UNREAD`;
- unread: add `UNREAD`;
- star: add `STARRED`;
- unstar: remove `STARRED`;
- important: add `IMPORTANT`;
- unimportant: remove `IMPORTANT`.

Mount mutation routes in `packages/backend/src/app.ts`.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/email_mutations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/providers/gmail packages/backend/src/routes/emails-mutations.ts packages/backend/src/db/repositories/emails.ts packages/backend/src/app.ts tests/integration/email_mutations.test.ts
git commit -m "feat: add Gmail mutation routes"
```

### Task 4.2: Mutation Keys And In-Memory Revert

**Files:**
- Modify: `packages/tui/src/state/keymap.ts`
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/tui/src/api-client.ts`
- Modify: `packages/tui/src/views/InboxView.tsx`
- Test: `tests/tui/mutation_keys.test.ts`
- Create: `scripts/acceptance/deliverable-4.ts`

- [ ] **Step 1: Write TUI mutation tests**

Cover keys `e`, `#`, `u`, `s`, `!`; automatic read call when preview/open marks read; in-memory optimistic update; revert on API failure; no confirmation prompt.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/mutation_keys.test.ts
```

- [ ] **Step 3: Implement TUI mutation behavior**

Keep status messages concise. Do not persist local DB directly from TUI. Route all mutations, including automatic mark-read on preview/open, through `api-client.ts`.

- [ ] **Step 4: Run tests**

```bash
bun test tests/tui/mutation_keys.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement and run A4 tmux acceptance**

`deliverable-4.ts` must validate `gmail-sweep-test`, refuse to mutate any message outside that label, report missing credentials/label/messages as BLOCKED, avoid treating BLOCKED as pass, and restore original labels where possible.

```bash
bun run scripts/acceptance/deliverable-4.ts
```

Expected: mutations operate only on `gmail-sweep-test` messages; local state changes after Gmail success; restore original labels where possible. BLOCKED requires user decision.

- [ ] **Step 6: Commit**

```bash
git add packages/tui tests/tui/mutation_keys.test.ts scripts/acceptance/deliverable-4.ts
git commit -m "feat: add TUI mutation keys"
```

## Chunk 5: History ID Incremental Sync

### Task 5.1: Durable History Queue And Cursor Invariants

**Files:**
- Create: `packages/backend/src/sync/queue.ts`
- Create: `packages/backend/src/sync/history.ts`
- Modify: `packages/backend/src/db/repositories/queues.ts`
- Modify: `packages/backend/src/db/repositories/sync-state.ts`
- Modify: `packages/backend/src/providers/gmail/types.ts`
- Modify: `packages/backend/src/providers/gmail/fake.ts`
- Modify: `packages/backend/src/providers/gmail/google.ts`
- Modify: `packages/backend/src/sync/baseline.ts`
- Modify: `packages/backend/src/routes/sync.ts`
- Test: `tests/unit/history_queue.test.ts`
- Test: `tests/integration/history_sync_fake.test.ts`

- [ ] **Step 1: Write queue invariant tests**

Cover:

- pending changes persist before hydration;
- duplicate history records dedupe by stable key: account ID, Gmail history ID, message ID, change type, and label ID when applicable;
- committed cursor does not advance while pending work remains;
- committed cursor advances after every pending change at or below the target watermark is applied;
- newer Inbox additions can hydrate before older pending work;
- stale history marks account repair-needed.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/history_queue.test.ts tests/integration/history_sync_fake.test.ts
```

- [ ] **Step 3: Implement queue and history sync**

Keep discovery and hydration separate. Re-read from pinned cursor as needed. Add Gmail provider methods/scenarios for history listing, stale cursor errors, and backlog simulation. Wire history sync into `POST /sync` without weakening baseline behavior. Add status fields for pending counts and target watermark.

Responsibility split:

- `queue.ts`: durable queue ordering, dedupe, and priority selection.
- `history.ts`: Gmail history discovery and drain orchestration.
- repository files: persistence only.
- route files: API/status only.

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/history_queue.test.ts tests/integration/history_sync_fake.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/sync packages/backend/src/db/repositories/queues.ts packages/backend/src/db/repositories/sync-state.ts packages/backend/src/providers/gmail packages/backend/src/routes/sync.ts tests/unit/history_queue.test.ts tests/integration/history_sync_fake.test.ts
git commit -m "feat: add durable history sync queue"
```

### Task 5.2: Repair Mode And TUI Status

**Files:**
- Modify: `packages/backend/src/sync/baseline.ts`
- Modify: `packages/backend/src/routes/sync.ts`
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/tui/src/views/App.tsx`
- Test: `tests/integration/history_repair.test.ts`
- Test: `tests/tui/sync_status.test.ts`
- Create: `scripts/acceptance/deliverable-5.ts`

- [ ] **Step 1: Write tests**

Assert stale history response enters repair mode and TUI shows a non-silent status. Assert fake 700-change/100-fetch scenario keeps cursor pinned while fresh message appears promptly and older pending work remains durable after fresh-message priority hydration.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/history_repair.test.ts tests/tui/sync_status.test.ts
```

- [ ] **Step 3: Implement repair/status behavior**

Repair mode performs list-based baseline repair before establishing a new committed cursor.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/history_repair.test.ts tests/tui/sync_status.test.ts tests/unit/history_queue.test.ts tests/integration/history_sync_fake.test.ts
```

- [ ] **Step 5: Implement and run A5 tmux acceptance**

`deliverable-5.ts` must run the actual TUI in tmux, validate real `gmail-sweep-test` prereqs, create or modify guarded test-label messages when safe, report BLOCKED with exact reason when not safe, verify cursor/status honesty after real history sync, and run the fake backlog/no-gap scenario.

```bash
bun run scripts/acceptance/deliverable-5.ts
```

Expected: real history changes for test-label messages apply; fake backlog proves no-gap behavior. BLOCKED requires user decision.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/sync packages/backend/src/routes/sync.ts packages/tui tests/integration/history_repair.test.ts tests/tui/sync_status.test.ts scripts/acceptance/deliverable-5.ts
git commit -m "feat: add history repair and sync status"
```

## Chunk 6: Search, Labels, And Terminal Ergonomics

### Task 6.1: Local Search And System Label Classification

**Files:**
- Create: `packages/backend/src/search/parser.ts`
- Create: `packages/backend/src/search/local.ts`
- Create: `packages/backend/src/labels/classify.ts`
- Create: `packages/backend/src/routes/search.ts`
- Modify: `packages/backend/src/app.ts`
- Test: `tests/unit/label_classification.test.ts`
- Test: `tests/unit/search_parser.test.ts`
- Test: `tests/integration/local_search.test.ts`

- [ ] **Step 1: Write tests**

Cover:

- category labels display as `Category: Promotions`, etc.;
- `UNREAD` controls state, not user label display;
- `INBOX`, `TRASH`, `SPAM`, `SENT`, and `DRAFT` are mailbox/location/status, not ordinary user labels;
- `STARRED` and `IMPORTANT` are state fields, not ordinary user labels;
- free text searches `body_text`, subject, sender, recipients, headers;
- operators work for `from:`, `to:`, `subject:`, `label:`, `is:unread`, `is:read`, `is:starred`, `is:important`, `before:`, `after:`;
- Gmail remote/vector search are not called.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/unit/label_classification.test.ts tests/unit/search_parser.test.ts tests/integration/local_search.test.ts
```

- [ ] **Step 3: Implement classification and local search**

Use parameterized SQL for all search queries. Mount `POST /search` in `packages/backend/src/app.ts`. Search must use only SQLite/local repositories and must not call Gmail provider search APIs, embeddings, or vector code.

- [ ] **Step 4: Run tests**

```bash
bun test tests/unit/label_classification.test.ts tests/unit/search_parser.test.ts tests/integration/local_search.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/search packages/backend/src/labels packages/backend/src/routes/search.ts packages/backend/src/app.ts tests/unit/label_classification.test.ts tests/unit/search_parser.test.ts tests/integration/local_search.test.ts
git commit -m "feat: add local search and label classification"
```

### Task 6.2: TUI Search, Unread Toggle, Scrolling, Help

**Files:**
- Create: `packages/tui/src/views/SearchInput.tsx`
- Create: `packages/tui/src/views/HelpOverlay.tsx`
- Modify: `packages/tui/src/api-client.ts`
- Modify: `packages/tui/src/state/keymap.ts`
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/tui/src/views/MessagePreview.tsx`
- Test: `tests/tui/search_and_keys.test.ts`
- Create: `scripts/acceptance/deliverable-6.ts`

- [ ] **Step 1: Write TUI tests**

Cover `/`, `U`, `[`, `]`, `?`, search result state, preview scroll reset on message change, and label display view model.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/search_and_keys.test.ts
```

- [ ] **Step 3: Implement TUI behavior**

Use `U` for all/unread toggle and `B` reserved for backfill. Ensure text does not overlap in narrow terminals.

- [ ] **Step 4: Run tests**

```bash
bun test tests/tui/search_and_keys.test.ts
```

- [ ] **Step 5: Implement and run A6 tmux acceptance**

`deliverable-6.ts` must validate real-service prereqs, use real cached `gmail-sweep-test` messages, run the actual TUI in tmux, treat missing setup as BLOCKED, and verify `U`, `[`, `]`, `?`, local body search, operator search, and semantic label display.

```bash
bun run scripts/acceptance/deliverable-6.ts
```

Expected: real cached test-label messages can be searched by body/operator; labels render semantically; `U`, scrolling, and help work. BLOCKED requires user decision.

- [ ] **Step 6: Commit**

```bash
git add packages/tui tests/tui/search_and_keys.test.ts scripts/acceptance/deliverable-6.ts
git commit -m "feat: add TUI search and ergonomics"
```

## Chunk 7: Bounded Backfill

### Task 7.1: Backfill Service And Routes

**Files:**
- Create: `packages/backend/src/sync/backfill.ts`
- Modify: `packages/backend/src/routes/sync.ts`
- Modify: `packages/backend/src/db/repositories/queues.ts`
- Test: `tests/integration/backfill_service.test.ts`

- [ ] **Step 1: Write backfill tests**

Cover:

- backend API accepts scope enum values `inbox`, `allMail`, `unread`, `starred`, and `label`;
- selected-label scope requires a label ID;
- All Mail maps to the Gmail all-mail query/scope without including Trash/Spam unless explicitly requested later;
- days must be a positive integer and defaults to `1` when omitted;
- job walks backward from the oldest cached boundary for the selected scope;
- when the selected scope has no cached messages, backend returns BLOCKED/needs-baseline status instead of starting an unbounded backfill;
- job stops at requested date window;
- Gmail discovery uses date-window-constrained queries and persisted page/backfill cursors;
- hydration respects `maxMessagesPerFetch`;
- backfill cursor advances only after discovered/fetched/hydrated work for that cursor is committed;
- current sync has priority over backfill.
- `POST /backfill` request/response contract matches the shapes below;
- `GET /backfill/status` returns active and recent jobs using the status enum below.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/backfill_service.test.ts
```

- [ ] **Step 3: Implement backfill service/routes**

Routes:

- `POST /backfill`
- `GET /backfill/status`

Backfill API contract:

```ts
type BackfillScope =
  | { type: "inbox" }
  | { type: "allMail" }
  | { type: "unread" }
  | { type: "starred" }
  | { type: "label"; labelId: string };

type BackfillStatus = "queued" | "discovering" | "hydrating" | "complete" | "blocked" | "failed";

interface StartBackfillRequest {
  scope: BackfillScope;
  days?: number; // default 1; must be positive integer
}

interface StartBackfillResponse {
  ok: true;
  jobId: string;
  status: Exclude<BackfillStatus, "blocked" | "failed">;
  scope: BackfillScope;
  window: { olderThan: string; newerThanOrEqual: string };
  maxMessagesPerFetch: number;
} | {
  ok: false;
  status: "blocked" | "failed";
  reason: string;
  scope: BackfillScope;
};

interface BackfillJobStatus {
  jobId: string;
  status: BackfillStatus;
  scope: BackfillScope;
  window: { olderThan: string; newerThanOrEqual: string };
  discovered: number;
  hydrated: number;
  pending: number;
  reason?: string;
}
```

`jobId` is durable and stable across restart. A blocked response must not create an active unbounded job.

Keep route code thin. Put algorithm and state handling in `packages/backend/src/sync/backfill.ts`.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/backfill_service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/sync/backfill.ts packages/backend/src/routes/sync.ts packages/backend/src/db/repositories/queues.ts tests/integration/backfill_service.test.ts
git commit -m "feat: add bounded backfill service"
```

### Task 7.2: Backfill TUI Flow And Summary Gating

**Files:**
- Create: `packages/tui/src/views/BackfillPrompt.tsx`
- Modify: `packages/tui/src/state/keymap.ts`
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/backend/src/summaries/worker.ts`
- Test: `tests/tui/backfill_prompt.test.ts`
- Test: `tests/unit/summary_backfill_gating.test.ts`
- Create: `scripts/acceptance/deliverable-7.ts`

- [ ] **Step 1: Write tests**

Cover `B` opens scope selection, the user selects scope, the TUI then asks days with default `1`, cancel works at both stages, status/errors render, selected days/scope are sent to backend, and backfilled summaries wait behind later locally cached messages in the relevant selected scope only.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/tui/backfill_prompt.test.ts tests/unit/summary_backfill_gating.test.ts
```

- [ ] **Step 3: Implement TUI and summary gating**

Keep the flow keyboard-only and compact. Summary gating must compare dates within the relevant scope so unrelated scopes do not block each other.

- [ ] **Step 4: Run tests**

```bash
bun test tests/tui/backfill_prompt.test.ts tests/unit/summary_backfill_gating.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement and run A7 tmux acceptance**

`deliverable-7.ts` must validate real-service prereqs, run the actual TUI in tmux, use a safe `gmail-sweep-test` or selected scope, press `B`, select a scope, accept default `1` day, and report exact BLOCKED reasons before stopping for user decision.

```bash
bun run scripts/acceptance/deliverable-7.ts
```

Expected: bounded real backfill runs safely or blocks with exact setup reason and stops for user decision.

- [ ] **Step 6: Commit**

```bash
git add packages/tui packages/backend/src/summaries/worker.ts tests/tui/backfill_prompt.test.ts tests/unit/summary_backfill_gating.test.ts scripts/acceptance/deliverable-7.ts
git commit -m "feat: add bounded backfill TUI"
```

## Chunk 8: Hardening And Final Acceptance

### Task 8.1: Rate Limits, Restart/Resume, And Error Surfaces

**Files:**
- Modify: `packages/shared/src/sync.ts`
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/backend/src/providers/gmail/fake.ts`
- Modify: `packages/backend/src/providers/ai/fake.ts`
- Modify: `packages/backend/src/summaries/worker.ts`
- Modify: `packages/backend/src/sync/history.ts`
- Modify: `packages/backend/src/sync/backfill.ts`
- Modify: `packages/backend/src/db/repositories/queues.ts`
- Modify: `packages/backend/src/routes/sync.ts`
- Modify: `packages/backend/src/routes/summaries.ts`
- Modify: `packages/tui/src/api-client.ts`
- Modify: `packages/tui/src/state/controller.ts`
- Modify: `packages/tui/src/views/App.tsx`
- Create: `packages/tui/src/views/StatusBar.tsx`
- Test: `tests/integration/rate_limit_status.test.ts`
- Test: `tests/integration/restart_resume.test.ts`
- Test: `tests/unit/config_edge_cases.test.ts`
- Test: `tests/tui/error_status.test.ts`

- [ ] **Step 1: Write hardening tests**

Cover Gmail/AI rate-limit status, worker pause/backoff, restart resumes pending history/backfill/summary work, config failure/missing/misconfigured provider cases, and TUI status is visible without blocking cached reading. Assert cached message list/detail remains navigable during Gmail and AI backoff. Expected status fields include backoff state, retry-after time when available, paused worker state, and resume progress.

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/integration/rate_limit_status.test.ts tests/integration/restart_resume.test.ts tests/unit/config_edge_cases.test.ts tests/tui/error_status.test.ts
```

- [ ] **Step 3: Implement hardening behavior**

Avoid broad retry loops. Use explicit statuses and bounded backoff. Define backend-to-TUI status fields in shared API/sync types, expose them through sync/summary status routes, fetch them through `api-client.ts`, store them in controller state, and render them in `StatusBar.tsx`.

- [ ] **Step 4: Run tests**

```bash
bun test tests/integration/rate_limit_status.test.ts tests/integration/restart_resume.test.ts tests/unit/config_edge_cases.test.ts tests/tui/error_status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages tests/integration/rate_limit_status.test.ts tests/integration/restart_resume.test.ts tests/unit/config_edge_cases.test.ts tests/tui/error_status.test.ts
git commit -m "feat: harden sync and summary status"
```

### Task 8.2: Full Verification And Final tmux Acceptance

**Files:**
- Create: `scripts/acceptance/deliverable-8.ts`
- Create: `scripts/acceptance/README.md`
- Modify: `package.json`

- [ ] **Step 1: Add acceptance README**

Document:

- required env vars;
- `gmail-sweep-test` label;
- test-message expectations;
- how BLOCKED differs from PASS;
- tmux usage and cleanup.

- [ ] **Step 2: Add final acceptance script**

Run A1-A8 or print the exact blocked gate and stop. The real-service path must require real configured Gmail and AI providers for Gmail/AI functionality; fake scenarios are supplemental and cannot replace it.

Required fake rare-failure scenarios:

- Gmail rate-limit/backoff;
- AI rate-limit/backoff;
- restart/resume with pending history, backfill, and summary work;
- mutation failure and TUI revert;
- history backlog and stale-history repair;
- summary provider malformed response/failure.

- [ ] **Step 3: Run full automated tests**

```bash
bun test
```

Expected: PASS.

- [ ] **Step 4: Run final tmux acceptance**

```bash
bun run scripts/acceptance/deliverable-8.ts
```

Expected: real-service smoke path with real configured Gmail/AI providers PASS or BLOCKED with exact reason requiring user decision; all listed fake rare-failure scenarios PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/acceptance
git commit -m "test: add final acceptance workflow"
```

## Plan Execution Notes

- Use TDD for each task: failing test, minimal implementation, passing test, commit.
- Keep every file small and focused. Split before files become hard to reason about.
- Do not add vector search, web UI, permanent delete, undo, or label editing.
- Do not run real mutation acceptance against ordinary mail. Only use `gmail-sweep-test` messages.
- If a tmux acceptance test fails, write a short bug plan in the task notes, fix it, rerun the same acceptance test, then continue.
- If real-service acceptance is blocked, stop for the user's decision before proceeding.
