# Feature Comparison: `claude` vs `glm` Worktrees (Codex review)

Source: Codex rescue task run at high effort, 2026-04-10. This supersedes `comparison-claude-vs-glm.md` — Codex caught several behaviors that the earlier pass missed.

## Feature matrix

| feature | claude worktree | glm worktree | code location |
|---|---|---|---|
| health/status endpoint | implemented | implemented | claude: `packages/backend/src/server.ts` (`GET /health`)<br>glm: `src/backend/routes/status.ts` (`GET /status`, DB probe) |
| OAuth auth flow (`/auth/url`, `/auth/callback`, `/auth/status`) | implemented | implemented | claude: `packages/backend/src/routes/auth.ts`, `packages/backend/src/services/gmail.ts`<br>glm: `src/backend/routes/auth.ts`, `src/backend/auth/oauth.ts`, `src/backend/auth/token-store.ts` |
| auth callback redirects back to frontend with query params | implemented | missing | claude: `packages/backend/src/routes/auth.ts`<br>glm: `src/backend/routes/auth.ts` returns JSON only |
| auth status includes authenticated email address | implemented | missing | claude: `packages/backend/src/routes/auth.ts`, `packages/backend/src/services/gmail.ts`<br>glm: `src/backend/routes/auth.ts` returns `{ authorized }` only |
| logout endpoint | implemented | missing | claude: `packages/backend/src/routes/auth.ts` (`DELETE /auth/logout`)<br>glm: checked `src/backend/routes/auth.ts` |
| config file auto-created with defaults when missing | implemented | missing | claude: `packages/backend/src/config.ts`<br>glm: `src/backend/config.ts` throws if config missing |
| runtime config read/update API (`GET /config`, `POST /config`) | implemented | missing | claude: `packages/backend/src/routes/config.ts`<br>glm: checked `src/backend/routes/*`, `src/backend/server.ts` |
| Google credential env overrides | implemented | missing | claude: `packages/backend/src/config.ts`<br>glm: checked `src/backend/config.ts` |
| sync fetches only `INBOX` from Gmail API | missing | implemented | claude: `packages/backend/src/services/gmail.ts` (date queries only)<br>glm: `src/backend/services/sync.ts`, `src/backend/services/gap-manager.ts` pass `labelIds: ["INBOX"]` |
| default email listing is inbox-only | implemented | missing | claude: `packages/backend/src/services/db.ts` (`labels LIKE '%INBOX%'`)<br>glm: `src/backend/routes/emails.ts` filters only `removed_state IS NULL` |
| email list filters: sender, `date_from`, `date_to`, subject, pagination | implemented | missing | claude: `packages/backend/src/routes/emails.ts`, `packages/backend/src/services/db.ts`, `packages/shared/src/types.ts`<br>glm: checked `src/backend/routes/emails.ts` |
| email list filters: unread and exact label name | missing | implemented | claude: checked `packages/backend/src/routes/emails.ts`, `packages/shared/src/types.ts`<br>glm: `src/backend/routes/emails.ts` |
| anchor list at newest unsummarized email | implemented | missing | claude: `packages/backend/src/routes/emails.ts`, `packages/backend/src/services/db.ts`, `packages/terminal/src/index.ts`, `packages/terminal/src/api.ts`<br>glm: checked `src/backend/routes/emails.ts`, `src/tui/app.ts` |
| `/sync` waits for sync completion and returns detailed counts | implemented | missing | claude: `packages/backend/src/routes/sync.ts`, `packages/backend/src/services/sync.ts`<br>glm: `src/backend/routes/sync.ts` returns `202 { status: "syncing" }` immediately |
| `/sync` runs asynchronously with in-memory route mutex | missing | implemented | claude: checked `packages/backend/src/routes/sync.ts`<br>glm: `src/backend/routes/sync.ts` |
| older-than backfill after newest/gap work | implemented | missing | claude: `packages/backend/src/services/sync.ts`<br>glm: checked `src/backend/services/sync.ts` |
| history-based incremental sync (`messagesAdded` / `messagesDeleted`) | missing | implemented | claude: checked `packages/backend/src/services/sync.ts`, `packages/backend/src/services/gmail.ts`<br>glm: `src/backend/services/sync.ts`, `src/backend/gmail/adapter.ts`, `src/backend/gmail/gmail-api.ts` |
| date-boundary gap tracking | implemented | missing | claude: `packages/backend/src/services/sync.ts`, `packages/backend/src/services/db.ts`<br>glm: checked `src/backend/services/sync.ts`, `src/backend/services/gap-manager.ts` |
| page-token gap tracking | missing | implemented | claude: checked `packages/backend/src/services/sync.ts`, `packages/backend/src/services/db.ts`<br>glm: `src/backend/services/sync.ts`, `src/backend/services/gap-manager.ts`, `src/backend/db/schema.ts` |
| gap inspection endpoint | implemented | implemented | claude: `packages/backend/src/routes/sync.ts` (`/sync/status`, `/sync/gaps`)<br>glm: `src/backend/routes/sync.ts` (`/sync/status`, `/sync/gaps`) |
| manual gap fill / abandon endpoints | missing | implemented | claude: checked `packages/backend/src/routes/sync.ts`<br>glm: `src/backend/routes/sync.ts` (`POST /sync/gaps/:id/fill`, `DELETE /sync/gaps/:id`) |
| periodic background auto-sync poller | missing | implemented | claude: checked `packages/backend/src/index.ts`<br>glm: `src/backend/index.ts`, `src/backend/services/auto-poller.ts` |
| on-demand per-email summary endpoint | implemented | missing | claude: `packages/backend/src/routes/emails.ts`, `packages/backend/src/services/email-ops.ts`<br>glm: checked `src/backend/routes/emails.ts` |
| background summarizer worker | implemented | implemented | claude: `packages/backend/src/services/summarizer.ts`, `packages/backend/src/routes/sync.ts`, `packages/backend/src/server.ts`<br>glm: `src/backend/services/summary-worker.ts`, `src/backend/index.ts`, `src/backend/routes/sync.ts` |
| periodic summarizer independent of sync | missing | implemented | claude: `packages/backend/src/services/summarizer.ts` has no timer/start loop<br>glm: `src/backend/services/summary-worker.ts`, `src/backend/index.ts` |
| summarizer status endpoint with processed/pending counts | implemented | missing | claude: `packages/backend/src/routes/summarizer.ts`, `packages/backend/src/services/summarizer.ts`<br>glm: checked `src/backend/routes/*` |
| summarizer handles HTTP 429 with exponential backoff and per-run failed-ID skip | implemented | missing | claude: `packages/backend/src/services/summarizer.ts`<br>glm: checked `src/backend/services/summary-worker.ts` |
| persisted summary state machine (`pending` / `processing` / `done` / `failed`) | missing | implemented | claude: checked `packages/backend/src/services/db.ts` schema/state fields<br>glm: `src/backend/db/schema.ts`, `src/backend/services/summary-worker.ts` |
| natural-language search parsing via LLM | implemented | missing | claude: `packages/backend/src/services/ai.ts`, `packages/backend/src/services/search.ts`<br>glm: checked `src/backend/services/search-parser.ts`, `src/backend/services/search.ts` |
| explicit operator search (`from:`, `to:`, `subject:`, `before:`, `after:`, `label:`, `is:`, `has:`) | missing | implemented | claude: checked `packages/backend/src/services/search.ts`, `packages/backend/src/services/ai.ts`<br>glm: `src/backend/services/search-parser.ts`, `src/backend/services/search.ts` |
| SQL keyword search over `subject` / `sender` / `body_text` | missing | implemented | claude: `packages/backend/src/services/db.ts` does not search `body_text`<br>glm: `src/backend/services/search.ts` |
| runtime semantic/vector search is wired end-to-end | implemented | missing | claude: `packages/backend/src/services/embed.ts`, `packages/backend/src/services/embeddings.ts`, `packages/backend/src/services/search.ts`, `packages/backend/src/server.ts`<br>glm: `src/backend/services/search.ts` supports optional embeddings, but `src/backend/index.ts` never supplies `embeddingProvider` |
| search result scores displayed in UI | implemented | missing | claude: `packages/terminal/src/views/search.ts`, `packages/web/src/components/SearchBar.tsx`<br>glm: checked `src/tui/components/email-list.ts`, `src/tui/components/search-bar.ts`, `src/tui/app.ts` |
| embedding generation wired into runtime after sync | implemented | missing | claude: `packages/backend/src/routes/sync.ts`, `packages/backend/src/services/sync.ts`, `packages/backend/src/services/embeddings.ts`<br>glm: `src/backend/services/embedding-worker.ts` exists but `src/backend/index.ts` never constructs/starts it |
| configurable embedding extraction strategies/templates | implemented | missing | claude: `packages/backend/src/config.ts`, `packages/backend/src/services/content.ts`, `packages/backend/src/services/embeddings.ts`, `packages/shared/src/types.ts`<br>glm: `src/backend/services/embedding-worker.ts` hardcodes `${subject} ${summary}` |
| local embedding provider (Transformers.js / local model) | implemented | missing | claude: `packages/backend/src/services/embed.ts`, `config.json.example`<br>glm: checked `src/backend/*` |
| OpenAI-compatible embedding provider | implemented | missing | claude: `packages/backend/src/services/embed.ts`, `packages/shared/src/types.ts`<br>glm: checked `src/backend/*` |
| HTML-to-text conversion and HTML-stub fallback for HTML-only mail | implemented | implemented | claude: `packages/backend/src/services/content.ts`, `packages/backend/src/services/gmail.ts`<br>glm: `src/backend/services/content.ts`, `src/backend/services/sync.ts`, `src/backend/services/gap-manager.ts` |
| raw HTML email rendering in a client | implemented | missing | claude: `packages/web/src/components/EmailPreview.tsx` (sandboxed `iframe`)<br>glm: `src/tui/components/detail-panel.ts` renders text only |
| raw Gmail message passthrough endpoint | missing | implemented | claude: checked `packages/backend/src/routes/emails.ts`<br>glm: `src/backend/routes/emails.ts`, `src/backend/gmail/gmail-api.ts` |
| archive action | implemented | implemented | claude: `packages/backend/src/routes/emails.ts`, clients in `packages/terminal/src/index.ts`, `packages/web/src/App.tsx`<br>glm: `src/backend/routes/emails.ts`, `src/tui/app.ts` |
| delete/trash action | implemented | implemented | claude: `packages/backend/src/routes/emails.ts`, clients in `packages/terminal/src/index.ts`, `packages/web/src/App.tsx`<br>glm: `src/backend/routes/emails.ts`, `src/tui/app.ts` |
| optimistic archive/delete with rollback on Gmail failure | missing | implemented | claude: `packages/backend/src/routes/emails.ts` waits for Gmail then mutates DB; no rollback path<br>glm: `src/backend/routes/emails.ts` |
| deleted emails stay hidden on subsequent `/emails` reloads | missing | implemented | claude: `packages/backend/src/services/db.ts` `trashEmail()` adds `TRASH` but leaves `INBOX`; `listEmails()` still matches `INBOX`<br>glm: `src/backend/routes/emails.ts` filters `removed_state IS NULL` |
| mark read / unread endpoints and TUI toggle | missing | implemented | claude: checked `packages/backend/src/routes/emails.ts`, `packages/terminal/src/index.ts`, `packages/web/src/App.tsx`<br>glm: `src/backend/routes/emails.ts`, `src/tui/api.ts`, `src/tui/app.ts` |
| terminal search UI (`/` shortcut and query input) | implemented | implemented | claude: `packages/terminal/src/index.ts`, `packages/terminal/src/views/search.ts`<br>glm: `src/tui/app.ts`, `src/tui/components/search-bar.ts` |
| full-width detail panel toggle in terminal UI | missing | implemented | claude: checked `packages/terminal/src/views/email.ts`, `packages/terminal/src/index.ts`<br>glm: `src/tui/app.ts`, `src/tui/components/detail-panel.ts` |
| web UI | implemented | missing | claude: `packages/web/src/App.tsx`, `packages/web/src/components/*`<br>glm: no web source present |
| terminal command to load list anchored around unsummarized mail | implemented | missing | claude: `packages/terminal/src/index.ts` (`l` / `L`), `packages/terminal/src/api.ts`<br>glm: checked `src/tui/app.ts`, `src/tui/api.ts` |
| Gmail API retry/backoff for 429/500/503 | missing | implemented | claude: checked `packages/backend/src/services/gmail.ts`<br>glm: `src/backend/gmail/gmail-api.ts` |
| verbose LLM request/response logging | missing | implemented | claude: checked `packages/backend/src/services/ai.ts`<br>glm: `src/backend/llm/openai-adapter.ts`, `src/backend/llm/anthropic-adapter.ts` |

## Notable findings not captured in the earlier comparison

- **`claude` has a live bug where trashed emails reappear:** `trashEmail()` adds the `TRASH` label but leaves `INBOX`, and `listEmails()` matches on `INBOX` — so deleted mail pops back on reload. glm avoids this via `removed_state IS NULL` filtering.
- **`glm` wires up embeddings but never actually uses them at runtime:** `EmbeddingWorker` and `vectorSearch` exist, but `src/backend/index.ts` never constructs or passes an `EmbeddingProvider`, so vector search silently falls back to SQL LIKE.
- **`claude`'s sync does not restrict to `INBOX`:** it fetches by date range only, so archived/trashed Gmail messages within the window will be pulled in.
- **`claude`'s `/sync` is synchronous and returns counts**, while `glm`'s `/sync` is fire-and-forget with a `202` and an in-memory mutex. Different contracts — clients can't be shared as-is.
- **`glm` has Gmail API retry/backoff for 429/500/503** baked into `gmail-api.ts`; `claude` has none.
- **`glm` has verbose LLM request/response logging** in both OpenAI and Anthropic adapters; `claude` does not.
- **`claude` has auto-creating config** with sensible defaults when `config.json` is absent and supports Google credential env overrides; `glm` throws on missing config.
- **Summarizer periodicity is reversed from the bug surface:** `claude` has 429 backoff + failed-ID skip but no standalone timer; `glm` has the timer but no backoff. Neither has the full combination.
