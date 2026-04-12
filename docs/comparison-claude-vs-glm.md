# Feature Comparison: `claude` vs `glm` Worktrees

**Summary:** `glm` has a richer Gmail API surface (read/unread toggles, raw-message passthrough, label listing, fast history-based incremental sync) and a soft-delete model with rollback. `claude` has a richer LLM/search/embedding stack (sqlite-vec KNN, configurable embedding providers incl. local Transformers.js, AI-parsed natural-language search, summarizer queue/backoff worker, multi-mode previews) and a proper web client.

## Feature matrix

| Feature | claude | glm | Component(s) |
|---|---|---|---|
| **Sync & Gmail API** | | | |
| Newest-first sync with batch budget | implemented | implemented | backend/sync |
| Gap tracking (date-boundary vs pageToken-based) | implemented (date boundaries) | implemented (pageToken) | backend/sync, backend/db |
| Older-than backfill (step 3 of sync cycle) | implemented | missing | backend/sync |
| History-based incremental sync (`messagesAdded`/`messagesDeleted`) | missing | implemented | backend/sync, backend/gmail |
| `historyId` persistence in `sync_state` | missing | implemented | backend/db, backend/sync |
| Auto-poller (periodic background sync) | missing | implemented | backend/services |
| Manual gap fill endpoint (`POST /sync/gaps/:id/fill`) | missing | implemented | backend/routes/sync |
| Delete/abandon gap endpoint (`DELETE /sync/gaps/:id`) | missing | implemented | backend/routes/sync |
| `syncInProgress` mutex exposed in `/sync/status` | missing | implemented | backend/routes/sync |
| Raw Gmail message passthrough (`GET /emails/:id/raw`) | missing | implemented | backend/routes/emails, backend/gmail |
| Archive email | implemented (hard state change) | implemented (soft `removed_state` + rollback on API failure) | backend/routes/emails, backend/db |
| Delete (trash) email | implemented | implemented (soft + rollback) | backend/routes/emails, backend/db |
| Mark read / unread endpoints | missing | implemented (`/emails/:id/read`, `/unread`) | backend/routes/emails, backend/gmail |
| List Gmail labels | missing | implemented (adapter: `listLabels`) | backend/gmail |
| Label-name filter for inbox listing | missing | implemented (`?label=` via `json_each`) | backend/routes/emails |
| Unread filter for inbox listing (`?unread=true/false`) | missing | implemented | backend/routes/emails |
| **AI / Summaries** | | | |
| Email summaries (description / action items / key points) | implemented | implemented | backend/ai, backend/llm |
| On-demand summary (`GET /emails/:id/summary`) | implemented | missing (summaries only produced in background) | backend/routes/emails |
| Background summarizer worker | implemented (single-pass, event-triggered) | implemented (interval-based, concurrency-3) | backend/services |
| Rate-limit (HTTP 429) backoff in summarizer | implemented | missing | backend/services/summarizer |
| Failed-email skip list inside summarizer run | implemented | missing (marks `ai_status='failed'`, no replay gating) | backend/services |
| `ai_status` column state machine (`pending`/`processing`/`done`/`failed`) | missing | implemented | backend/db |
| `/summarizer/status` endpoint (processed/pending counts) | implemented | missing | backend/routes/summarizer |
| "Anchor at newest unsummarized" email listing flag | implemented (`anchor_unsummarized=true`) | missing | backend/routes/emails, backend/db |
| LLM provider: Anthropic | implemented | implemented | backend/ai, backend/llm |
| LLM provider: OpenAI-compatible | implemented | implemented | backend/ai, backend/llm |
| Configurable LLM `baseUrl` (custom endpoints) | implemented | implemented | backend/config |
| **Search** | | | |
| Semantic vector search over emails | implemented (sqlite-vec `vec0` KNN, cosine) | implemented (JS-side cosine over BLOB column) | backend/search, backend/db |
| AI-parsed natural-language search (LLM extracts sender/date/subject) | implemented | missing | backend/search, backend/ai |
| Operator-based query parsing (`from:`/`to:`/`subject:`/`before:`/`after:`/`label:`/`is:`/`has:`) | missing | implemented | backend/services/search-parser |
| SQL-only fallback (LIKE over subject/sender/body) | implemented | implemented | backend/search |
| Query includes `has:actions`/`has:no-actions` operator | missing | implemented | backend/services/search-parser |
| Date-range filter in search | implemented (LLM extracts) | implemented (`before:`/`after:` operators) | backend/search |
| **Embeddings** | | | |
| Embeddings storage | implemented (`vec_embeddings` vec0 virtual table) | implemented (`embedding BLOB` column) | backend/db |
| Background embedding generation triggered by sync | implemented | implemented (separate `EmbeddingWorker`) | backend/services/embeddings |
| Configurable embedding provider: OpenAI-compatible | implemented | missing (hardcoded "mock" model tag) | backend/services/embed |
| Local embedding provider (Transformers.js / BGE-M3) | implemented | missing | backend/services/embed |
| User-pluggable "extraction strategy" templates for embedding text | implemented | missing (hardcoded `subject + summary`) | backend/config, backend/services/embeddings |
| Per-strategy re-embed (multiple embeddings per email) | partial (schema supports it conceptually) | missing | backend/db |
| **HTML email handling** | | | |
| `body_text` and `body_html` stored separately | implemented | implemented | backend/db |
| HTML→text conversion via `html-to-text` | implemented | implemented | backend/services/content |
| HTML-fallback stub detection ("Your email client does not support HTML") | implemented | implemented (via shared `content.ts` helper) | backend/services/content |
| Stub-aware `body_text` derivation used in gap fills and incremental sync | implemented | implemented | backend/services/sync, gap-manager |
| **Config / Auth** | | | |
| Runtime config file | implemented (`~/.gmail-sweep/config.json`) | implemented (TOML, path via CLI arg) | backend/config |
| `GET /config` + `POST /config` runtime update | implemented | missing | backend/routes/config |
| OAuth flow (`/auth/url`, `/auth/callback`, `/auth/status`) | implemented | implemented | backend/routes/auth, backend/auth |
| Logout endpoint | implemented (`DELETE /auth/logout`) | missing | backend/routes/auth |
| Token persistence to disk | implemented | implemented | backend/auth |
| **Clients** | | | |
| Terminal / TUI client | implemented (OpenTUI) | implemented (blessed) | terminal |
| Web client (React + Vite) | implemented | missing | web |
| Email preview: summary mode | implemented | implemented | terminal, web |
| Email preview: plain-text mode | implemented | implemented | terminal |
| Email preview: rendered HTML mode (sandboxed iframe) | implemented (web only) | missing | web |
| TUI search bar `/` shortcut | implemented | implemented | terminal |
| TUI detail panel full-width toggle | missing | implemented | terminal |

## Notable asymmetries

### `glm`'s killer features `claude` lacks

- `historyId`-based incremental sync
- Auto-poller (background polling loop)
- Read / unread / raw endpoints on individual messages
- `listLabels` adapter method
- Label- and unread-filtered inbox listing
- Soft-delete with rollback on Gmail API failure
- Operator search syntax (`from:`, `label:`, `has:actions`, …)
- `/status` healthcheck with DB probe

### `claude`'s killer features `glm` lacks

- `vec0` KNN (proper ANN index) via sqlite-vec
- Local embeddings via Transformers.js
- LLM-parsed natural-language search
- User-tunable extraction strategies for embedding text
- Summarizer rate-limit backoff
- `/summarizer/status` endpoint
- `anchor_unsummarized` inbox anchoring
- On-demand per-email summary endpoint
- `GET` / `POST /config`
- Logout endpoint
- Web UI

## Known bugs worth flagging

- **claude** — gap-fill and hardcoded embedding-dimension issues identified in the Codex review (see `/codex:review` output).
- **glm** — `vectorSearch` decodes embeddings with `Float64Array` at `src/backend/services/search.ts:107`, but the embedding worker writes `Float32Array` at `src/backend/services/embedding-worker.ts:47`. Vector search across non-empty embeddings is almost certainly producing garbage scores.
