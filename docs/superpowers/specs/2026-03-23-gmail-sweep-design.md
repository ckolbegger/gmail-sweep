# gmail-sweep — Design Specification

A terminal-first Gmail client with AI-powered inbox management. Browse, search, summarize, and triage email from the terminal or a web browser, backed by a shared TypeScript service.

## 1. System Architecture

### Monorepo Structure (npm workspaces)

```
gmail-sweep/
  package.json              ← root workspace config
  packages/
    backend/                ← Fastify HTTP server (port 3141)
      src/
        routes/             ← REST endpoints
        services/
          gmail.ts          ← Gmail API + OAuth2
          sync.ts           ← Cursor-based sync with gap management
          db.ts             ← SQLite + sqlite-vec
          ai.ts             ← Provider-agnostic LLM (summarize, query parsing)
          embed.ts          ← Embedding provider (local Transformers.js or openai-compatible)
          search.ts         ← Vector + filter search
          content.ts        ← Configurable email content extraction
    terminal/               ← OpenTUI client
    web/                    ← React + Vite client
    shared/                 ← TypeScript types, API contract
```

### Design Principles

- **Backend owns all external communication.** Gmail API, SQLite, and LLM providers are only accessed by the backend. Clients are thin HTTP consumers.
- **`shared/` is the API contract.** Both clients import types from `shared/` — neither defines its own request/response types.
- **All business logic lives in the backend.** Clients handle presentation and user input only.

### Data Flow

```
Terminal (OpenTUI)  or  Web (React)
        ↓ HTTP / REST
  Backend (Fastify :3141)
    ├── SQLite DB           (emails, labels, sync cursor, gaps)
    ├── sqlite-vec          (vector search)
    ├── Gmail API           (OAuth2, sync, archive, delete)
    ├── LLM Provider        (Anthropic / OpenAI / Ollama / LMStudio)
    └── Embedding Provider  (local: @huggingface/transformers, or openai-compatible endpoint)
```

## 2. Backend API

### Auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/url` | Returns Google OAuth2 consent URL |
| GET | `/auth/callback` | OAuth2 redirect handler, stores token |
| GET | `/auth/status` | `{ authenticated: bool, email: string }` |
| DELETE | `/auth/logout` | Revokes and removes stored token |

Authentication uses OAuth2 browser flow. User clicks a link, browser opens Google's consent screen, token stored locally in `~/.gmail-sweep/tokens.json`.

### Emails

| Method | Path | Description |
|--------|------|-------------|
| GET | `/emails` | List from local DB (paginated) |
| GET | `/emails/:id` | Full email (plain + HTML body) |
| GET | `/emails/:id/summary` | AI summary (cached in DB) |
| POST | `/emails/:id/archive` | Remove INBOX label via Gmail API (Gmail's archive) |
| POST | `/emails/:id/delete` | Move to Trash via Gmail API |

`GET /emails` supports query parameters: `?sender=&date_from=&date_to=&subject=`

### Sync

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync` | Run one sync cycle |
| GET | `/sync/status` | Full sync state overview |
| GET | `/sync/gaps` | List all gaps with details |

**`POST /sync` request:**
```json
{ "batchSize": 500 }
```

**`POST /sync` response:**
```json
{
  "fetched": 500,
  "newEmails": 300,
  "gapsFilled": 150,
  "olderFetched": 50,
  "remainingGaps": [{ "id": 1, "newerBoundary": "...", "olderBoundary": "...", "estimatedCount": 200 }]
}
```

**`GET /sync/status` response:**
```json
{
  "totalSynced": 1247,
  "newestDate": "2026-03-23T14:30:00Z",
  "oldestDate": "2026-01-01T08:00:00Z",
  "gaps": [],
  "hasGaps": false
}
```

**`GET /sync/gaps` response:**
```json
{
  "gaps": [
    { "id": 1, "newerBoundary": "2026-03-20T00:00:00Z", "olderBoundary": "2026-03-15T00:00:00Z", "estimatedCount": 200 }
  ],
  "totalMissing": 200
}
```

#### Sync Algorithm (per cycle)

```
remaining = batchSize                          // e.g., 500

Step 1: Fetch newest
  Fetch emails newer than our newest stored email
  remaining -= fetched
  If fetched < available → new gap created

Step 2: Fill gaps (oldest gap first)
  While remaining > 0 and gaps exist:
    Fetch emails in gap range (capped by remaining)
    remaining -= fetched
    If gap fully filled → remove gap
    If partially filled → shrink gap boundaries

Step 3: Fetch older
  If remaining > 0 and no gaps:
    Fetch emails older than our oldest stored email
    remaining -= fetched
```

Gap lifecycle: created when Step 1 fetch doesn't cover all new emails. Shrunk as Step 2 fills from the edges. Deleted when fully filled. Multiple gaps may accumulate over time; repeated syncing fills all of them.

### Search

| Method | Path | Description |
|--------|------|-------------|
| POST | `/search` | Natural language vector search |

**Request:**
```json
{ "query": "emails from Sarah about project deadline", "limit": 20 }
```

**Response:**
```json
{ "emails": [...], "scores": [0.98, 0.74, 0.61] }
```

#### AI-Parsed Search Pipeline

Natural language queries go through the LLM first to extract structured filters + a semantic query:

```
User: "emails from Sarah last week about the project deadline"
  → AI extracts: { sender: "sarah", date_from: "2026-03-16", date_to: "2026-03-23" }
  → Semantic query: "project deadline"
  → Backend: SQL filter by sender + date, then rank by embedding similarity
```

Fast column filtering narrows the candidate set, then semantic ranking finds the best matches.

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Current app config |
| POST | `/config` | Update LLM or embedding provider, model, base URL |

Config stored in `~/.gmail-sweep/config.json`. LLM providers:
- **Anthropic** — Claude models
- **OpenAI** — GPT-4o etc.
- **OpenAI-compatible** — Ollama, LMStudio (custom base URL)

Embedding providers:
- **local** — `@huggingface/transformers` in-process (default: `Xenova/bge-m3`, 1024d, 8K context)
- **openai-compatible** — any `/v1/embeddings` endpoint (LMStudio, Ollama)

## 3. Database Schema

### emails

```sql
CREATE TABLE emails (
  id             TEXT PRIMARY KEY,      -- Gmail message ID
  thread_id      TEXT NOT NULL,
  subject        TEXT,
  sender         TEXT NOT NULL,
  date           TEXT NOT NULL,         -- ISO 8601
  snippet        TEXT,
  body_text      TEXT,                  -- always populated (see Content Extraction)
  body_html      TEXT,                  -- nullable, raw HTML if present
  labels         TEXT NOT NULL,         -- JSON array
  summary        TEXT,                  -- JSON-serialized EmailSummary (see below)
  has_embedding  INTEGER DEFAULT 0,
  embedding_strategy TEXT,             -- strategy ID that produced the embedding
  synced_at      TEXT NOT NULL
);

CREATE INDEX idx_emails_date ON emails(date DESC);
CREATE INDEX idx_emails_sender ON emails(sender);
CREATE INDEX idx_emails_thread ON emails(thread_id);
```

### sync_state

```sql
CREATE TABLE sync_state (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  newest_date   TEXT,
  oldest_date   TEXT,
  total_synced  INTEGER DEFAULT 0,
  last_sync_at  TEXT
);
```

### sync_gaps

```sql
CREATE TABLE sync_gaps (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  newer_boundary   TEXT NOT NULL,     -- date of oldest email above gap
  older_boundary   TEXT NOT NULL,     -- date of newest email below gap
  estimated_count  INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_gaps_boundaries ON sync_gaps(newer_boundary, older_boundary);
```

### email_embeddings

```sql
-- Stored as a regular table with BLOB vectors (not a vec0 virtual table)
-- because vec0 does not support composite primary keys.
-- vec_distance_cosine() operates on BLOB float arrays directly.
CREATE TABLE email_embeddings (
  email_id  TEXT NOT NULL,
  strategy  TEXT NOT NULL,           -- extraction strategy ID
  vector    BLOB NOT NULL,           -- float32 LE array, dimension matches config.embedding.dimension
  PRIMARY KEY (email_id, strategy)
);
```

Embedding dimension is set by `config.embedding.dimension` (default: 1024 for `Xenova/bge-m3`). Changing the dimension requires re-embedding all emails — change the `activeStrategy` name to trigger this automatically.

Query example:
```sql
SELECT e.*, vec_distance_cosine(v.embedding, ?) AS score
FROM email_embeddings v
JOIN emails e ON e.id = v.email_id
WHERE v.strategy = ?
ORDER BY score ASC
LIMIT 20;
```

## 4. Content Extraction

### HTML-to-Text Conversion

During sync, `body_text` is always populated:

1. If the email has a `text/plain` part → store it in `body_text`
2. If the email only has `text/html` → convert to plain text using `html-to-text` library, store result in `body_text`
3. If both exist → use `text/plain` for `body_text`, store original HTML in `body_html`

AI summary, vector search, and terminal display all consume `body_text` without caring whether the original was HTML.

### Embedding Content Strategy

Embeddings contain **semantic content only** — no sender, no date:

```
"Subject: {subject}\n\n{body_text (truncated to 8000 chars)}"
```

Sender and date are structured data handled by indexed columns with exact/range queries.

### Configurable Extraction Pipeline

Each extraction strategy is a named, versioned pipeline (e.g., `"v1-plain"`, `"v2-strip-preamble"`, `"v3-llm-cleaned"`). The active strategy is stored in `~/.gmail-sweep/config.json`.

The `embedding_strategy` column on the emails table tracks which strategy produced each embedding. When the active strategy changes, emails with a mismatched strategy are considered stale and re-embedded on next sync or on-demand.

**A/B trials:** The `email_embeddings` table supports multiple embeddings per email (keyed by `email_id` + `strategy`). Note: sqlite-vec `vec0` may not support composite primary keys — if so, use a synthetic key or a separate virtual table per strategy. To trial a new extraction prompt:

1. Run strategy A on a batch of emails
2. Switch to strategy B, re-embed the same batch
3. Run the same search queries against both and compare result quality
4. `POST /search` accepts an optional `strategy` param to query a specific embedding set

### Embeddings are generated lazily:
- Batched after each sync cycle for newly fetched emails
- If an email is searched before it has an embedding, generated on the fly

## 5. AI Summary Format

The `summary` column stores a JSON-serialized `EmailSummary`:

```typescript
interface EmailSummary {
  description: string;    // single sentence description
  actionItems: string[];  // bullet list of action items
  keyPoints: string[];    // bullet list of key points
}
```

Summaries are generated on first view and cached in the DB. Never re-generated unless explicitly requested.

## 6. Database Scaling Strategy

### sqlite-vec Performance Characteristics

sqlite-vec uses brute-force (flat) vector search — it compares the query vector against every stored vector linearly.

Default model: `Xenova/bge-m3` (1024 dimensions, float32, 8K token context).

| Emails | Embedding storage (1024d) | Vector search time |
|--------|---------------------------|-------------------|
| 10k | ~40 MB | ~5-10ms |
| 100k | ~400 MB | ~30-80ms |
| 500k | ~2 GB | ~200-500ms |
| 1M | ~4 GB | ~500ms-1s |

Using a larger model via `openai-compatible` (e.g. 1536d): multiply storage by 4×, search times by ~3-4×.

### Mitigations

**Primary mitigation (built-in):** AI-parsed search filters on structured columns (sender, date, subject) *before* vector search. A broad 200k email archive might narrow to 500 candidates before vector comparison runs — sub-millisecond.

**If scaling becomes an issue:**

1. **Partition embeddings by date range** — only search recent emails by default, expand on request
2. **Swap vector backend** — replace sqlite-vec with a proper ANN engine (hnswlib, chromadb) behind the same search service interface. The provider-agnostic service boundary means this doesn't affect clients.
3. **Pre-cluster emails by topic** — narrow search scope before vector comparison

**Recommendation:** Start with sqlite-vec. It keeps everything in a single file with zero dependencies and handles a typical personal inbox (50k-200k emails) without issues.

## 7. Client Design

### Shared Behavior (Terminal + Web)

Both clients call the same backend REST API. Both support the same key bindings:

| Key | Inbox View | Email View |
|-----|-----------|------------|
| ↑/↓ or j/k | Navigate email list | — |
| Tab | Toggle preview: summary ↔ full text | Toggle summary ↔ full text |
| Enter | Open email full-screen | — |
| a | Archive (one-key) | Archive |
| d | Delete (one-key) | Delete |
| / | Open search | — |
| r | Refresh / sync | — |
| Esc | — | Back to inbox |
| q | Quit | — |

### Terminal Client (OpenTUI)

**Split-pane inbox layout:**
- **Left pane:** Email list — date, sender, subject (truncated)
- **Right pane:** Preview — subject, sender, date, and labels at top. Body area toggles between AI summary and full plain text via Tab.

**AI Summary view (in preview pane):**
- Single sentence description
- Bullet list of action items (labeled "ACTION ITEMS")
- Bullet list of key points (labeled "KEY POINTS")

**Full Text view (in preview pane):**
- `body_text` content (HTML already converted to plain text during sync)

**Full-screen email view:** Enter opens the email full-screen with the same Tab toggle and action keys. Esc returns to inbox.

**Search mode:** `/` opens a search input. Natural language queries are AI-parsed into structured filters + semantic query. Results display with relevance scores (percentage). Shows the AI-extracted filters for transparency.

### Web Client (React + Vite)

Full parity with terminal, same backend API. Key differences:

- **HTML email rendering** — renders `body_html` natively in a sandboxed iframe. Toggle to plain text or AI summary view.
- **Responsive layout** — sidebar email list + main content pane (same split-pane concept)
- **Same key bindings** — j/k, Tab, a, d, /, r all work
- **No additional business logic** — all AI, sync, and search logic lives in the backend

### HTML Email Handling

| Client | Default View | Toggle Options |
|--------|-------------|----------------|
| Terminal | `body_text` (plain text) | Tab: AI summary ↔ full text |
| Web | `body_html` (rendered HTML) | Toggle: HTML ↔ plain text ↔ AI summary |

Both clients: AI summary and vector search always use `body_text`, never raw HTML.

## 8. Shared Types (packages/shared)

```typescript
interface Email {
  id: string;              // Gmail message ID
  threadId: string;
  subject: string;
  from: string;
  date: string;            // ISO 8601
  snippet: string;         // Gmail preview text
  bodyText: string;        // always populated
  bodyHtml: string | null; // raw HTML if present
  labels: string[];
  summary: EmailSummary | null;
  hasEmbedding: boolean;
  embeddingStrategy: string | null;
}

interface EmailSummary {
  description: string;     // single sentence
  actionItems: string[];   // bullet list
  keyPoints: string[];     // bullet list
}

interface Gap {
  id: number;
  newerBoundary: string;   // ISO 8601
  olderBoundary: string;   // ISO 8601
  estimatedCount: number;
}

interface SyncResult {
  fetched: number;
  newEmails: number;
  gapsFilled: number;
  olderFetched: number;
  remainingGaps: Gap[];
}

interface SyncStatus {
  totalSynced: number;
  newestDate: string;
  oldestDate: string;
  gaps: Gap[];
  hasGaps: boolean;
}

interface SearchRequest {
  query: string;
  limit?: number;
  strategy?: string;       // optional: target specific embedding strategy
}

interface SearchResult {
  emails: Email[];
  scores: number[];
}

interface ParsedQuery {
  filters: {
    sender?: string;
    date_from?: string;
    date_to?: string;
    subject?: string;
  };
  semanticQuery: string;
}

interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  apiKey?: string;
  baseUrl?: string;        // for Ollama / LMStudio
}

interface EmbeddingConfig {
  provider: 'local' | 'openai-compatible';
  model: string;
  dimension: number;       // must match the model's output; drives BLOB sizing and cosine math
  baseUrl?: string;        // required when provider is 'openai-compatible' (e.g. LMStudio, Ollama)
  apiKey?: string;         // optional — many local endpoints don't require one
}

// provider: 'local'
//   Uses @huggingface/transformers to run the model in-process via ONNX Runtime.
//   No API key, no network calls after first run. Model files (~560MB FP32 / ~140MB quantized
//   for bge-m3) are downloaded once and cached by the runtime.
//   BGE-M3 uses symmetric embedding — no query prefix is applied for queries or documents.
//
// provider: 'openai-compatible'
//   Calls any OpenAI-compatible /v1/embeddings endpoint (LMStudio, Ollama, etc.).
//   Set baseUrl to the local server, e.g. "http://localhost:1234/v1".
//   No query prefix is applied — the serving endpoint handles it if needed.
```

## 9. Configuration

All configuration stored in `~/.gmail-sweep/config.json`:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "sk-..."
  },
  "embedding": {
    "provider": "local",
    "model": "Xenova/bge-m3",
    "dimension": 1024
  },
  // To use LMStudio or Ollama instead:
  // "embedding": {
  //   "provider": "openai-compatible",
  //   "model": "nomic-embed-text-v1.5",
  //   "baseUrl": "http://localhost:1234/v1",
  //   "dimension": 768
  // },
  "sync": {
    "defaultBatchSize": 500
  },
  "contentExtraction": {
    "activeStrategy": "v1-plain",
    "strategies": {
      "v1-plain": {
        "type": "template",
        "template": "Subject: {{subject}}\n\n{{body_text | truncate:8000}}"
      }
    }
  }
}
```

## 10. Technology Stack

| Component | Technology |
|-----------|-----------|
| Monorepo | npm workspaces |
| Backend server | Fastify |
| Database | SQLite (better-sqlite3) |
| Vector search | sqlite-vec |
| Gmail API | googleapis |
| OAuth2 | google-auth-library |
| HTML-to-text | html-to-text |
| LLM (Anthropic) | @anthropic-ai/sdk |
| LLM (OpenAI / compatible) | openai |
| Embeddings (local) | @huggingface/transformers |
| Embeddings (API) | openai (openai-compatible) |
| Terminal client | OpenTUI |
| Web client | React + Vite |
| Shared types | TypeScript |
| Language | TypeScript throughout |
