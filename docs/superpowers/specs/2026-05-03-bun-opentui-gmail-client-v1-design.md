# Bun OpenTUI Gmail Client v1 Design

## Requirements Checklist

This spec is greenfield. Design and implementation work must not inspect, read, copy, or use files from the Claude or GLM worktrees, or any other non-Codex worktree, unless the user explicitly reverses this instruction.

- Use Bun for backend, terminal frontend, package management, and tests.
- Use Hono for the backend HTTP API.
- Use OpenTUI React for the terminal client.
- Use `bun:sqlite` for local storage.
- Normal user entrypoint is the TUI; it starts the backend automatically if needed.
- If the TUI starts the backend, it stops only that backend process by default on shutdown.
- Backend remains independently runnable.
- Store local data under `~/.gmail-sweep/`.
- Support multiple configured Gmail accounts, with one active account at a time.
- Use separate per-account tokens and SQLite databases.
- Gmail OAuth credentials come from environment variables.
- OAuth must use browser redirect to a local callback; no copy/paste code flow.
- Auto-open browser for OAuth and fall back to printing the URL.
- Request Gmail full mail scope: `https://mail.google.com/`.
- Default sync batch/hydration limit is configurable and defaults to `100`.
- First sync is Inbox-first.
- Establish a list-based baseline, then use Gmail History ID for ongoing sync.
- Never advance the committed history cursor until all covered changes are applied.
- Reread/merge/dedupe history changes while the cursor is pinned.
- Prioritize fresh Inbox-visible messages over older backlog hydration.
- Detect expired history cursors and repair with a list-based baseline.
- Support full-body local cache for every hydrated message.
- Extract canonical terminal-readable `body_text` from MIME parts.
- For HTML-only email, extract text from HTML and store the original HTML.
- Replace bad plain-text HTML-client warnings with HTML-derived text.
- Store body extraction audit fields showing source and reason.
- Gmail mutations in v1: archive, Trash, read/unread, star/unstar, important/unimportant.
- `#`/trash behavior means move to Trash, not permanent delete.
- No mutation confirmations and no undo in v1.
- Durable DB mutation state is committed only after Gmail confirms success.
- Terminal starts Inbox newest-first.
- Unread messages render bold; read messages render normal.
- Opening/previewing a message marks it read automatically.
- Split pane is default, with full-screen reading mode available.
- `Tab` toggles preview/detail content between AI summary and full canonical text.
- `[` and `]` scroll preview/detail content up/down.
- Include all-vs-unread toggle.
- Use Gmail-like keys: `e` archive, `#` Trash, `u` unread, `r` refresh/sync.
- Include star and important toggles.
- Custom labels are display-only in v1.
- Gmail system labels receive special display treatment.
- Basic local text/operator search is in scope.
- Free-text local search includes canonical `body_text`, subject, sender, recipients, and relevant headers.
- Gmail remote search and vector search are out of scope for this spec.
- AI summaries are in scope; vector search is a later separate spec.
- Support OpenAI and Anthropic behind an AI provider abstraction.
- AI secrets come from env vars; config stores provider/model/defaults and env var references.
- Summaries are lazy on viewed emails and cached.
- Background summary prefetch should prepare the next likely message.
- Summary priority must place current reading ahead of baseline backlog ahead of backfilled mail.
- AI calls are not canceled once started; queued work is reprioritized.
- Rate limits pause/back off with visible status while cached mail stays usable.
- Backfill is explicit, bounded, and lower priority than current sync.
- Backfill prompts for scope, then asks how many days to backfill, defaulting to `1`.
- Backfill walks backward from the oldest locally cached boundary for the selected scope.
- Backfilled messages are summarized only after later locally cached messages in scope are summarized.
- Built-in dev mode includes fake Gmail/AI providers, default seeded inbox, and named scenarios.
- Automated tests use fake providers and temp data.
- The implementation plan must list tmux acceptance tests up front for each deliverable.
- End-of-deliverable tmux acceptance tests run the actual TUI against real configured services when the deliverable touches Gmail or AI.
- Real Gmail acceptance tests use a dedicated test label such as `gmail-sweep-test`.
- Missing credentials/test label/test messages must be reported as blocked or skipped, not passed, and the user must decide whether to proceed.

## 1. Scope And Architecture

The v1 app is a greenfield, local-first Gmail client with a shared backend and terminal frontend. The primary product surface is the terminal UI. The normal user command starts the OpenTUI React app; the TUI probes the configured localhost backend, starts it if no compatible backend is running, waits for `/status`, then connects. If the TUI starts the backend, it stops only that backend process by default on shutdown; shutdown behavior may be configurable later. The backend remains independently runnable for tests, debugging, provider probes, and direct API inspection.

No web client or web parity requirement is in scope for v1.

Core stack:

- Bun runtime, package manager, and test runner.
- Hono backend over localhost HTTP.
- OpenTUI React terminal client.
- `bun:sqlite` per-account local database.
- `~/.gmail-sweep/` local app data.
- Provider interfaces for Gmail and AI.
- Built-in dev mode with fake Gmail/AI providers, a default seeded inbox, and named scenarios.

The first spec covers v1 foundation only:

- OAuth with no copy/paste flow.
- Multi-account config with one active account.
- Safe sync with an initial list-based baseline and Gmail History ID incremental sync after a valid baseline exists.
- Durable pending-change queues so history cursors are not advanced until discovered changes are applied.
- Local full-body cache with MIME-aware content extraction.
- HTML-only email handling: extract canonical terminal-readable text from HTML, store original HTML, and use extracted text for summaries.
- Bad plain-text fallback handling: if `text/plain` is only an HTML-client warning, replace canonical text with HTML-derived text and record why.
- Gmail mutations: archive, Trash, read/unread, star/unstar, important/unimportant.
- Terminal workflow: split pane, full-screen reading mode, Gmail-like keymap, unread bolding, unread/all toggle, and scrollable preview/detail bodies.
- Basic local text/operator search.
- Lazy AI summaries for viewed emails.
- Background summary prefetch so the next likely message is summarized before the user opens it.
- Priority summary scheduling, with active reading before baseline backlog before backfilled mail.
- Bounded, user-triggered backfill from the oldest cached boundary.
- Automated tests plus tmux-driven acceptance tests for each deliverable.

Vector search is intentionally excluded and gets a later separate spec.

## 2. Data Model And Local Storage

Local app data lives under `~/.gmail-sweep/`:

```text
~/.gmail-sweep/
  config.json
  accounts.json
  accounts/
    <account-id>/
      tokens.json
      mail.sqlite
```

`config.json` stores global app settings, the active account ID, backend host/port behavior, sync defaults, AI provider/model defaults, AI secret env var references, and dev-mode provider/scenario settings.

`accounts.json` stores known account IDs, email addresses, display names, and per-account metadata needed before opening the account database.

Each account has isolated tokens and a separate SQLite database. The backend opens only the active account database. This avoids account-scoping bugs in SQL and keeps backups/deletion straightforward. Cross-account search is out of scope.

The database stores full hydrated messages, not metadata-only records. Each message stores:

- Gmail message ID and thread ID.
- Subject, sender, recipients, date, snippet, and relevant headers.
- Gmail label IDs and derived state fields.
- Raw or normalized MIME metadata needed for audit/debugging.
- `body_text`, the canonical terminal-readable body.
- `body_html`, when HTML exists.
- Body extraction audit fields such as selected source, reason, warning-pattern match, text length, and HTML-derived text length.
- Summary status and cached summary JSON.
- Sync bookkeeping such as history IDs and hydration state.

Sync state is durable and explicit:

- Current baseline scope state, starting with Inbox.
- Last committed Gmail `historyId`.
- Pending history pages/changes discovered but not fully applied.
- Pending message hydration queue.
- Bounded backfill jobs and queues.
- Summary status per message: missing, queued, in progress, complete, failed, or rate-limited.

The central storage invariant is: the app never advances a durable sync cursor, history cursor, or backfill cursor until all work represented by that cursor has been applied and committed locally.

## 3. Sync, Backfill, And Gap Prevention

The backend has two sync paths: current-mail sync and bounded backfill.

Current-mail sync starts with an Inbox baseline. The backend captures a starting Gmail history marker, lists Inbox message IDs, hydrates full messages in batches capped by `sync.maxMessagesPerFetch`, stores full bodies locally, and records labels/status. The default cap is `100`. After the baseline is durable, the backend runs history sync from the starting marker so changes that happened during the baseline are applied.

Ongoing sync uses Gmail History ID with strict cursor safety and flexible hydration order. The backend persists discovered history changes into an idempotent pending queue before hydration. The committed `historyId` advances only when all changes up to the target history watermark are applied.

If 700 changes exist and the hydration cap is 100, sync applies 100 and leaves 600 pending. On the next sync, the backend may reread from the old committed cursor, merge and dedupe newly discovered changes, and hydrate newer Inbox additions first so fresh mail appears promptly. Cursor safety must not imply FIFO hydration.

Sync gap-prevention invariants:

1. Pending history changes are persisted before hydration starts.
2. Pending changes are uniquely keyed and idempotent.
3. Applied changes are marked durable.
4. The committed history cursor advances only when no unapplied changes remain at or below the target history watermark.
5. Newer changes may be prioritized for hydration without erasing older pending work.
6. A crash resumes from pending work or rereads from the old committed cursor.
7. If Gmail returns stale or expired history, the account enters repair mode and performs a list-based baseline repair before establishing a new committed cursor.

Backfill is explicit, bounded, and lower priority than current sync. The user chooses a scope, then the TUI asks `Backfill how many days?` with default `1`. The backend walks backward from the oldest locally cached message in that scope, discovers IDs for that date window, hydrates in capped batches, and stops when the requested window is complete. Backfill never runs unbounded through the mailbox.

Backfill scopes include Inbox, All Mail, Unread, Starred, and selected labels. The implementation plan must include these selectable scopes unless the user explicitly approves a reduced scope.

Backfilled messages do not consume summary capacity ahead of current mail. They become eligible for background summaries only after later locally cached messages in the relevant scope are summarized.

## 4. Terminal UX And Keymap

The terminal client is the primary product surface. It starts in an Inbox newest-first split-pane view. The left pane is the message list; the right pane previews the selected message. Unread messages render bold, read messages render normal. Opening or previewing a message marks it read automatically.

The preview pane and full-screen message view both support `Tab` to toggle between AI summary and full canonical email text. If no summary exists, the summary view requests one lazily. The backend summary prefetch worker also tries to keep the next likely message ready before the user opens it.

The preview pane and full-screen message body are scrollable independently of the message list. `[` scrolls the visible message content up and `]` scrolls it down. Moving to a different selected message resets that message content scroll position unless the implementation plan chooses to preserve per-message scroll state.

The UI supports a hybrid reading model:

- Split pane by default for scanning.
- Full-screen message mode for focused reading.
- All-vs-unread toggle for the active view.
- Local search/filter mode for cached messages.
- Sync/backfill/status indicators visible without blocking reading.

Gmail-like keymap for v1:

| Key | Action |
| --- | --- |
| `j` / `k` or arrows | Move selection |
| `[` / `]` | Scroll preview/message content up/down |
| `Enter` | Open full-screen message |
| `Esc` | Return to split pane or close mode |
| `Tab` | Toggle summary/full text |
| `e` | Archive |
| `#` | Move to Trash |
| `u` | Mark unread |
| `r` | Refresh/sync |
| `s` | Star/unstar |
| `!` | Important/unimportant |
| `/` | Local search/filter |
| `?` | Help overlay |

One key, finalized in the implementation plan, toggles all vs unread-only. One key opens bounded backfill flow. The implementation plan should choose keys that do not conflict with text input modes.

No confirmation prompts and no undo are included in v1. Mutations happen immediately from the user's perspective, with backend correctness rules described below.

## 5. AI Summaries And Body Extraction

Every hydrated message stores full body content locally. The backend extracts a canonical `body_text` for terminal display and summaries:

- If a real `text/plain` body exists, use it.
- If the message is HTML-only, extract readable text from `text/html`.
- If `text/plain` is only a fallback warning such as "your email client does not support HTML," replace canonical text with HTML-derived text.
- Use known warning patterns plus conservative quality heuristics.
- Store audit fields showing selected source and reason.
- Store original HTML when present so later features can inspect or render it.

Summaries are cached per message and generated from canonical `body_text`, never from raw HTML or bad fallback text. The summary format is:

```ts
interface EmailSummary {
  description: string;
  actionItems: string[];
  keyPoints: string[];
}
```

Summary scheduling priorities:

1. The selected/open message if the user requests summary view and no summary exists.
2. Next likely messages in the current list, so the next email is ready by the time the user reaches it.
3. Unsummarized current baseline mail newer than any backfill boundary.
4. Backfilled messages, only after all locally cached messages later than the backfill window in the relevant scope are summarized.

AI calls are not canceled once started. If the user moves quickly, queued work is reprioritized. Rate limits pause the worker with visible status while cached mail remains readable.

Provider support is abstracted from v1 and includes OpenAI and Anthropic. Config stores provider/model/defaults. Secrets come from environment variables or config references to env var names.

## 6. Search, Labels, And Message State

Search in v1 is local-cache only. Free-text search matches cached canonical `body_text`, subject, sender, recipients, and relevant headers. It also supports operators such as:

- `from:`
- `to:`
- `subject:`
- `label:`
- `is:unread`
- `is:read`
- `is:starred`
- `is:important`
- `before:`
- `after:`

Search results only include messages already synced or backfilled into the local database. Gmail remote search and vector search are out of scope for this spec.

Labels are displayed but not edited in v1, except for state labels controlled by explicit actions. Gmail system labels receive special treatment instead of appearing as ordinary user labels:

- `UNREAD`: controls row styling and unread filters.
- `INBOX`, `TRASH`, `SPAM`, `SENT`, `DRAFT`: mailbox/location/status.
- `STARRED`, `IMPORTANT`: displayed as state and toggled by key actions.
- `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`: displayed as `Category: Personal/Social/Promotions/Updates/Forums`.
- Custom user labels and unknown non-special labels appear in the normal labels area.

Message mutations in v1:

- Archive removes `INBOX`.
- Trash moves the message to `TRASH`; no permanent delete.
- Read/unread toggles `UNREAD`.
- Star toggles `STARRED`.
- Important toggles `IMPORTANT`.

All mutations go through the backend Gmail provider. The TUI may update its in-memory view optimistically while the request is in flight, but the backend commits the local database change only after Gmail confirms success. If Gmail fails, the TUI reverts the in-memory change and shows status. History sync later reconciles the final Gmail state.

## 7. Auth, Config, And Providers

OAuth uses Google's desktop loopback flow with no copy/paste step. Gmail OAuth client credentials come from environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

The app starts a temporary loopback callback listener, auto-opens the browser to the Google consent URL, falls back to printing the URL if browser open fails, exchanges the callback code for tokens, and stores account tokens under `~/.gmail-sweep/accounts/<account-id>/tokens.json`.

The app requests `https://mail.google.com/`. The `#` key moves messages to Trash; v1 does not permanently delete messages.

Config includes:

- Active account ID.
- Sync defaults, including `sync.maxMessagesPerFetch = 100`.
- Backend host/port behavior.
- AI provider/model defaults.
- References to environment variable names for AI secrets.
- Dev mode provider selection and scenario name.

Providers are explicit interfaces:

- Gmail provider: real Google API implementation plus fake dev implementation.
- AI provider: OpenAI, Anthropic, and fake dev implementation.
- Storage: per-account SQLite repository layer.

Built-in dev mode is part of the product architecture. It supports a default seeded inbox plus named scenarios such as:

- `large-inbox`
- `history-backlog`
- `rate-limit`
- `html-fallback`
- `mutation-failure`
- `bounded-backfill`

Dev mode is required for deterministic automated tests, demos, and rehearsing TUI flows. It must not replace real-provider acceptance tests for deliverables that touch Gmail or AI behavior.

## 8. Testing, Acceptance, And Deliverables

Automated tests use fake providers and temp data for deterministic coverage, but fake providers are not accepted as proof that Gmail or AI behavior works.

Automated test coverage:

- Unit tests: operator parsing, body extraction, label classification, sync cursor invariants, pending queue dedupe, summary prioritization, config loading.
- Backend integration tests: Hono routes with fake Gmail/AI providers, temp SQLite databases, sync/backfill/mutation flows.
- TUI behavior tests: controller/state tests for navigation, key handling, view mode toggles, scroll state, unread filters, search state, and error/status handling.

The implementation plan must list the tmux acceptance tests up front for each deliverable so progress can be tracked and reported. Each implementation deliverable ends with a tmux-driven acceptance test of the actual TUI. If the deliverable touches Gmail or AI behavior, that tmux test uses real configured providers. Fake-provider tmux tests may be used as rehearsal or regression coverage, but they do not replace the real-service acceptance gate.

Real-service acceptance guardrails:

- Gmail tests operate only on messages with a dedicated test label such as `gmail-sweep-test`.
- Fetch limits stay low.
- No permanent delete; Trash only.
- Mutation tests create or require controlled test messages and restore/cleanup where possible.
- AI tests use small fixture messages or selected test-label messages.
- Missing credentials, missing test label, or missing test messages are reported as blocked/skipped explicitly; they are not treated as pass, and implementation must stop for the user's decision before proceeding past that acceptance gate.

If a tmux acceptance test fails, write a focused bug-fix plan, execute it, rerun the same acceptance test, and only then move to the next acceptance test.

Recommended vertical foundation slices:

1. **Project skeleton and real provider probes**
   - Bun workspace, Hono backend, OpenTUI boot shell, config layout.
   - Real Gmail loopback OAuth and probes: profile, labels, tiny Inbox/test-label list.
   - Real OpenAI/Anthropic probe when credentials exist.
   - tmux acceptance: TUI boots, starts backend, displays auth/provider status, and can run provider probes.

2. **Gmail baseline sync vertical slice**
   - Real/fake Gmail provider interface.
   - Sync a tiny baseline from the dedicated test label and Inbox with full hydration.
   - Store full bodies locally.
   - TUI shows synced newest-first messages.
   - tmux acceptance: sync real test-label messages and inspect list/detail.

3. **MIME/body extraction and AI summary vertical slice**
   - Canonical `body_text`, HTML-only extraction, bad plain-text fallback replacement, audit fields.
   - OpenAI/Anthropic summary providers plus fake AI.
   - Lazy summary view and background next-message prefetch.
   - tmux acceptance: real AI summarizes test-label messages, including an HTML/fallback fixture if available.

4. **Gmail mutations vertical slice**
   - Archive, Trash, read/unread, star, important.
   - Backend commits local DB only after Gmail success.
   - TUI may update in-memory view while request is in flight and must revert on failure.
   - tmux acceptance: perform mutations only on `gmail-sweep-test` messages and verify Gmail-confirmed local state.

5. **History ID incremental sync vertical slice**
   - Committed cursor, pending deduped history queue, applied markers.
   - Priority hydration so fresh Inbox/test-label messages appear before older backlog drains.
   - tmux acceptance: create/modify real test-label messages, run sync, verify history changes apply and cursor behavior is reported correctly.
   - Large backlog behavior is additionally covered by fake scenario because creating hundreds of real messages is impractical.

6. **Search, labels, and terminal ergonomics**
   - Local text/operator search.
   - Gmail system label classification.
   - Unread/all toggle, `[` / `]` preview scrolling, help overlay.
   - tmux acceptance: search and navigate real cached test-label messages; verify scrolling and label display.

7. **Bounded backfill vertical slice**
   - Select scope, ask days defaulting to `1`, walk backward from oldest cached boundary.
   - Hydrate bounded queue below current-sync priority.
   - Summary priority gates backfilled mail behind newer cached mail.
   - tmux acceptance: run real bounded backfill against a safe selected scope or test label; if the required real-service setup is missing, report exactly why acceptance is blocked and stop for the user's decision.

8. **Hardening pass**
   - Rate limits, restart/resume, error/status surfaces, config edge cases.
   - tmux acceptance: run a final real-service smoke path plus targeted fake scenarios for rare failures.

## 9. API Shape

The backend API should stay small and client-oriented. Exact schemas are finalized in the implementation plan, but v1 needs these surfaces:

- `GET /status`: backend health, version, active account, provider mode.
- Auth/account:
  - `GET /auth/status`
  - `POST /auth/start`
  - `GET /auth/callback`
  - `GET /accounts`
  - `POST /accounts/active`
- Sync:
  - `POST /sync`
  - `GET /sync/status`
  - `POST /backfill`
  - `GET /backfill/status`
- Emails:
  - `GET /emails`
  - `GET /emails/:id`
  - `POST /emails/:id/archive`
  - `POST /emails/:id/trash`
  - `POST /emails/:id/read`
  - `POST /emails/:id/unread`
  - `POST /emails/:id/star`
  - `POST /emails/:id/unstar`
  - `POST /emails/:id/important`
  - `POST /emails/:id/unimportant`
- Summaries:
  - `GET /emails/:id/summary`
  - `POST /emails/:id/summary`
  - `GET /summaries/status`
- Search:
  - `POST /search`
- Provider probes:
  - `POST /providers/gmail/probe`
  - `POST /providers/ai/probe`

Provider probe endpoints must be safe and bounded. They are for setup and acceptance, not general mailbox operations.

## 10. Open Questions For Implementation Planning

These do not block the design, but the implementation plan must decide them before coding:

- Exact key for all-vs-unread toggle.
- Exact key for bounded backfill flow.
- Exact SQLite schema and migration strategy.
- Exact fake scenario file format.
- Whether OpenTUI process spawning uses Bun subprocess APIs directly or a small supervisor module.
- Which HTML-to-text library to use under Bun, or whether to start with a small parser plus targeted tests.
- How real-service acceptance tests discover or create `gmail-sweep-test` messages safely.
