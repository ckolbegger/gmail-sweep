# Port Claude Features to GLM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the LLM/search/embedding/config/web-client features that the `claude` worktree has but the `glm` worktree lacks, adapted to glm's Bun + Hono + `bun:sqlite` stack.

**Architecture:** glm is a single-package Bun project using Hono routes and `bun:sqlite`. claude is an npm-workspaces monorepo using Fastify and `better-sqlite3` + `sqlite-vec`. Every feature below ports the *behavior* from claude, not the source files. glm's schema (a single `emails` table with columns including `embedding BLOB`, `ai_status`, `summary`, `removed_state`) is kept; new tables / columns are added where needed. Embedding storage migrates to a dedicated `vec_embeddings` vec0 virtual table, superseding the current `embedding BLOB` column and its known Float64/Float32 mismatch bug.

**Tech Stack:** Bun, TypeScript, Hono, `bun:sqlite`, `sqlite-vec` (vec0 virtual table), `@huggingface/transformers` (local BGE-M3), `openai` SDK (OpenAI-compatible embeddings), React + Vite (new web client), Vitest/Bun test runner.

**Reference implementation:** `~/src/gmail-sweep/worktrees/claude/packages/...` — cited per feature.

---

## Stack differences you must respect

| claude | glm | Implication |
|---|---|---|
| `better-sqlite3` + `sqliteVec.load(db)` | `bun:sqlite` Database | Use `db.loadExtension(<path>)`. `sqlite-vec` npm ships a precompiled `.so`/`.dylib`/`.dll`; resolve via `require.resolve('sqlite-vec-linux-x64/vec0.so')` or similar, then pass to `loadExtension`. |
| Fastify plugins with `app.get/post` | Hono routers via `new Hono()` | Every new route is added to an existing router file under `src/backend/routes/`. |
| `~/.gmail-sweep/config.json` (JSON, runtime-writable) | `config.toml` loaded at startup from CLI arg (`smol-toml`, read-only) | Runtime `POST /config` must write back to the same TOML file and surface a "restart required for some fields" note for keys the server reads only at boot. |
| Embeddings: `vec_embeddings` vec0 virtual table | `embedding BLOB` column on `emails` (currently decoded with `Float64Array` against `Float32Array` writer — broken) | Phase 1 migrates to vec0. After migration the column is dropped. The existing bug is fixed incidentally by switching to `bun:sqlite` Buffers feeding vec0 directly. |
| `packages/shared/src/types.ts` | No shared-types package; types colocated in `src/backend/**` | Introduce `src/shared/types.ts` used by both the backend and the new web client. |
| `packages/web` (Vite + React) | No web client | Introduce `web/` at worktree root (a sibling of `src/`), own its own `package.json`, so it can stay Bun-agnostic. |

---

## File structure overview

New/modified files in `glm`:

- **Create:** `src/shared/types.ts`
- **Modify:** `src/backend/db/schema.ts`, `src/backend/db/index.ts`
- **Create:** `src/backend/services/embed-provider.ts` (factory for openai-compatible + local transformers)
- **Modify:** `src/backend/services/embedding-worker.ts` (use new provider + vec0)
- **Create:** `src/backend/services/extraction-strategies.ts`
- **Modify:** `src/backend/services/search.ts` (vec0 KNN + AI query parse)
- **Modify:** `src/backend/services/summary-worker.ts` (rate-limit backoff)
- **Modify:** `src/backend/llm/provider.ts`, `src/backend/llm/openai-adapter.ts`, `src/backend/llm/anthropic-adapter.ts` (add `parseSearchQuery`)
- **Modify:** `src/backend/routes/emails.ts` (`anchor_unsummarized`, on-demand `/summary`)
- **Modify:** `src/backend/routes/sync.ts` (older-than backfill step)
- **Modify:** `src/backend/routes/auth.ts` (logout)
- **Create:** `src/backend/routes/config.ts`, `src/backend/routes/summarizer.ts`
- **Modify:** `src/backend/config.ts` (new config shape: embedding, contentExtraction; save back to TOML)
- **Modify:** `src/backend/server.ts` (wire new routes + services)
- **Modify:** `src/backend/index.ts` (construct embed provider from config)
- **Create:** `web/` subdirectory (React + Vite client)
- **Create/modify:** corresponding `test/backend/...` files

---

## Dependency / phase ordering

Phases must be executed in order because later phases depend on earlier state:

1. **Phase A — Schema + sqlite-vec foundation.** Introduces the `vec_embeddings` virtual table and extension loading. Everything vector-search-related depends on it.
2. **Phase B — Shared types package.** Needed by the configurable embed provider, extraction strategies, and the web client.
3. **Phase C — Config refactor.** Extends the config shape with `embedding` and `contentExtraction` and adds persistent `POST /config`. Required by Phase D.
4. **Phase D — Embeddings: pluggable providers + extraction strategies + vec0 writes.** Replaces the current hardcoded "mock" model and broken BLOB decode.
5. **Phase E — Search: vec0 KNN + LLM query parser.** Depends on Phases A and D.
6. **Phase F — Summarizer: backoff + status + on-demand endpoint + anchor.** Independent of Phases D/E but depends on Phase B types.
7. **Phase G — Auth logout + older-than backfill.** Independent; can run in parallel with F.
8. **Phase H — Web client.** Depends on Phase B (shared types) and should happen last so all backend endpoints it consumes exist.
9. **Phase I — Nice-to-haves.** Implementation-level niceties (auth UX, config UX, credential overrides) that are not user-facing scope. Runs after all user-facing phases. Each item in this phase is independent and can be skipped individually.

---

## Feature 1 — sqlite-vec `vec0` KNN (Phase A) `[source: both]`

**User-facing behavior:** Vector search uses an indexed ANN table instead of loading every candidate into JS and computing cosine by hand. Fixes the existing Float64/Float32 decode bug incidentally. No API shape change.

**Reference:** `claude/packages/backend/src/services/db.ts:75-110, 274-306`.

**Why first:** All embedding-writing code (Phase D) and search code (Phase E) must target the new table.

**Files:**
- Create: `src/backend/db/vec-loader.ts` — resolves and loads the `sqlite-vec` native extension into a `bun:sqlite` Database.
- Modify: `src/backend/db/schema.ts` — add `vec_embeddings` virtual-table DDL constant.
- Modify: `src/backend/db/index.ts` — load extension before running schema; add migration that backfills existing `emailing BLOB` rows into `vec_embeddings` then drops the column.
- Test: `test/backend/vec-embeddings.test.ts` — verifies extension loads, table created, round-trip insert + KNN returns ordered distances.

### Task 1.1: Failing test for extension loader

- [ ] **Step 1: Write the failing test**

Create `test/backend/vec-embeddings.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import Database from "bun:sqlite";
import { loadVecExtension } from "../../src/backend/db/vec-loader";

describe("vec-loader", () => {
  test("loads sqlite-vec extension into a bun:sqlite db", () => {
    const db = new Database(":memory:");
    loadVecExtension(db);
    const row = db.query("SELECT vec_version() AS v").get() as { v: string };
    expect(typeof row.v).toBe("string");
    expect(row.v.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/ckolbegger/src/gmail-sweep/worktrees/glm && bun test test/backend/vec-embeddings.test.ts`
Expected: FAIL — "Cannot find module '../../src/backend/db/vec-loader'".

- [ ] **Step 3: Implement `vec-loader.ts`**

Create `src/backend/db/vec-loader.ts`:

```ts
import type Database from "bun:sqlite";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

// sqlite-vec ships per-platform packages with the native lib under `vec0.{so,dylib,dll}`.
// Each platform package exports `getLoadablePath()` returning the absolute path.
function resolveExtensionPath(): string {
  // sqlite-vec 0.1.7: `require('sqlite-vec').getLoadablePath()` is the documented entry.
  const mod = req("sqlite-vec") as { getLoadablePath?: () => string };
  if (typeof mod.getLoadablePath !== "function") {
    throw new Error("sqlite-vec: getLoadablePath() not available; update sqlite-vec package");
  }
  return mod.getLoadablePath();
}

export function loadVecExtension(db: Database): void {
  const path = resolveExtensionPath();
  // bun:sqlite uses loadExtension(path)
  (db as any).loadExtension(path);
}
```

- [ ] **Step 4: Re-run the test**

Run: `bun test test/backend/vec-embeddings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/db/vec-loader.ts test/backend/vec-embeddings.test.ts
git commit -m "feat(db): load sqlite-vec extension into bun:sqlite"
```

### Task 1.2: Failing test for vec0 virtual table + KNN round-trip

- [ ] **Step 1: Append test to same file**

```ts
import { initDb } from "../../src/backend/db";

describe("vec_embeddings virtual table", () => {
  test("round-trip insert then MATCH returns ordered distances", () => {
    const db = initDb(":memory:");
    const dim = 4;
    // Replace default dimension for the test — see Task 1.3 note
    // (this test assumes 4-dim; real schema uses 1024)
    db.run("DROP TABLE IF EXISTS vec_embeddings");
    db.run(
      `CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${dim}] distance_metric=cosine, +email_id TEXT)`
    );
    const toBuf = (v: number[]) => {
      const f = new Float32Array(v);
      return Buffer.from(f.buffer);
    };
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["a", toBuf([1, 0, 0, 0])]);
    db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", ["b", toBuf([0, 1, 0, 0])]);
    const rows = db
      .query("SELECT email_id, distance FROM vec_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance")
      .all(toBuf([1, 0, 0, 0]), 2) as Array<{ email_id: string; distance: number }>;
    expect(rows[0].email_id).toBe("a");
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`vec_embeddings` not created by `initDb` yet).

- [ ] **Step 3: Add DDL to `schema.ts`**

Modify `src/backend/db/schema.ts` — append after the existing `SCHEMA` constant:

```ts
export const EMBEDDING_DIMENSION = 1024;

export const VEC_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  embedding float[${EMBEDDING_DIMENSION}] distance_metric=cosine,
  +email_id TEXT
);
`;
```

- [ ] **Step 4: Wire loader + VEC_SCHEMA into `initDb`**

Modify `src/backend/db/index.ts`:

```ts
import Database from "bun:sqlite";
import { SCHEMA, VEC_SCHEMA } from "./schema";
import { loadVecExtension } from "./vec-loader";

function runMigrations(db: Database): void {
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "removed_state")) {
    db.run("ALTER TABLE emails ADD COLUMN removed_state TEXT DEFAULT NULL");
  }
  migrateEmbeddingsToVec0(db);
}

function migrateEmbeddingsToVec0(db: Database): void {
  const cols = db.query("PRAGMA table_info(emails)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "embedding")) return; // already migrated

  // NOTE: existing BLOBs were written as Float32Array by the worker but decoded
  // as Float64Array in search — all prior embeddings are unreliable. We drop,
  // do not copy, so the background worker re-embeds on next run.
  db.run("ALTER TABLE emails DROP COLUMN embedding");
  db.run("ALTER TABLE emails DROP COLUMN embedding_model");
  db.run("ALTER TABLE emails DROP COLUMN embedding_generated_at");
  // Also clear ai_status to nothing — embedding is decoupled from summary status
  // (no-op: embedding state now lives solely in vec_embeddings presence)
}

export function initDb(path: string): Database {
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA foreign_keys=ON;");
  loadVecExtension(db);
  db.exec(SCHEMA);
  db.exec(VEC_SCHEMA);
  runMigrations(db);
  return db;
}
```

Also remove `embedding BLOB, embedding_model TEXT, embedding_generated_at INTEGER` from the `CREATE TABLE emails` definition in `schema.ts`.

- [ ] **Step 5: Re-run all db-adjacent tests**

Run: `bun test test/backend/db.test.ts test/backend/vec-embeddings.test.ts`
Expected: the new test passes; existing db tests pass.
Note: `test/backend/embedding-worker.test.ts` references the removed `embedding` column and will be rewritten as a failing test at the start of Phase D (Feature 4, Task 4.3).
Note: `test/backend/search.test.ts` `vector search` and `cosine similarity` describe blocks reference the removed `embedding` column and will be rewritten in Phase E (Feature 6, Task 6.2).

- [ ] **Step 6: Commit**

```bash
git add src/backend/db/schema.ts src/backend/db/index.ts test/backend/vec-embeddings.test.ts
git commit -m "feat(db): migrate embeddings to sqlite-vec vec0 virtual table"
```

---

## Feature 2 — Shared types module (Phase B) `[source: claude]`

**User-facing behavior:** None directly; prerequisite for config refactor, extraction strategies, and the web client consuming the same response types as the backend.

**Reference:** `claude/packages/shared/src/types.ts`.

**Files:**
- Create: `src/shared/types.ts`
- Modify: `tsconfig.json` — ensure `src/shared` is in `include` (it already is via `src`).

### Task 2.1: Create shared types

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export interface EmailSummary {
  description: string;
  actionItems: string[];
  keyPoints: string[];
}

export interface Email {
  id: string;
  thread_id: string;
  sender: string;
  recipients: string[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  date_sent: number;
  date_received: number;
  labels: Array<{ id: string; name: string }>;
  is_read: boolean;
  is_starred: boolean;
  ai_status: "pending" | "processing" | "done" | "failed";
  summary: string | null;
  action_items: string[] | null;
  key_points: string[] | null;
  removed_state: "archived" | "deleted" | null;
}

export interface ParsedQuery {
  filters: {
    sender?: string;
    date_from?: string;
    date_to?: string;
    subject?: string;
  };
  semanticQuery: string;
}

export interface LLMConfig {
  provider: "openai" | "anthropic";
  api_key: string;
  model: string;
  base_url: string;
}

export interface EmbeddingConfig {
  provider: "local" | "openai-compatible";
  model: string;          // e.g. "BAAI/bge-m3" or "text-embedding-3-small"
  dimension: number;      // must match vec_embeddings DDL (1024)
  api_key?: string;
  base_url?: string;
}

export interface ExtractionStrategy {
  type: "template";
  template: string;       // e.g. "Subject: {{subject}}\n\n{{body_text}}"
}

export interface ContentExtractionConfig {
  activeStrategy: string;
  strategies: Record<string, ExtractionStrategy>;
}

export interface SummarizerStatus {
  status: "running" | "idle";
  processed: number;
  pending: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): add shared type module for backend+web"
```

---

## Feature 3 — `GET`/`POST /config` runtime endpoints + expanded config shape (Phase C) `[source: both]`

**User-facing behavior:** Client can fetch the current config and PATCH keys (llm, embedding, contentExtraction, sync) without restarting for runtime-mutable keys. TOML on disk is rewritten on POST.

**Reference:** `claude/packages/backend/src/routes/config.ts`, `claude/packages/backend/src/config.ts`.

**Files:**
- Modify: `src/backend/config.ts` — add `embedding`, `content_extraction` sections; add `saveConfig(path, config)`.
- Create: `src/backend/routes/config.ts` — Hono router with `GET /config` and `POST /config`.
- Modify: `src/backend/server.ts` — mount router, thread `configPath` into deps.
- Modify: `src/backend/index.ts` — pass `configPath` into `createApp`.
- Create: `test/backend/routes/config.test.ts`.

### Task 3.1: Extend config shape

- [ ] **Step 1: Write failing test**

Create `test/backend/config.embedding.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { loadConfig } from "../../src/backend/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config embedding section", () => {
  test("parses embedding section with local provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-"));
    const p = join(dir, "config.toml");
    writeFileSync(p, `
[auth]
credentials_path = "/tmp/c"
token_path = "/tmp/t"
[embedding]
provider = "local"
model = "BAAI/bge-m3"
dimension = 1024
[content_extraction]
active_strategy = "default"
[content_extraction.strategies.default]
type = "template"
template = "Subject: {{subject}}\\n\\n{{body_text}}"
`);
    const cfg = loadConfig(p);
    expect(cfg.embedding.provider).toBe("local");
    expect(cfg.embedding.dimension).toBe(1024);
    expect(cfg.content_extraction.strategies.default.template).toContain("{{subject}}");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Extend `src/backend/config.ts`**

Add interfaces:

```ts
export interface EmbeddingSectionCfg {
  provider: "local" | "openai-compatible";
  model: string;
  dimension: number;
  api_key?: string;
  base_url?: string;
}

export interface ExtractionStrategyCfg {
  type: "template";
  template: string;
}

export interface ContentExtractionCfg {
  active_strategy: string;
  strategies: Record<string, ExtractionStrategyCfg>;
}
```

Extend `Config`:

```ts
export interface Config {
  server: { host: string; port: number };
  auth: { credentials_path: string; token_path: string };
  sync: { batch_size: number; poll_interval_seconds: number };
  llm: { provider: string; api_key: string; model: string; base_url: string };
  embedding: EmbeddingSectionCfg;
  content_extraction: ContentExtractionCfg;
}
```

In `loadConfig`, parse:

```ts
const embRaw = (data.embedding ?? {}) as Record<string, unknown>;
const embedding: EmbeddingSectionCfg = {
  provider: (embRaw.provider as "local" | "openai-compatible") ?? "local",
  model: String(embRaw.model ?? "BAAI/bge-m3"),
  dimension: Number(embRaw.dimension ?? 1024),
  api_key: embRaw.api_key ? String(embRaw.api_key) : undefined,
  base_url: embRaw.base_url ? String(embRaw.base_url) : undefined,
};

const ceRaw = (data.content_extraction ?? {}) as Record<string, unknown>;
const strategiesRaw = (ceRaw.strategies ?? {}) as Record<string, { type?: string; template?: string }>;
const strategies: Record<string, ExtractionStrategyCfg> = {};
for (const [k, v] of Object.entries(strategiesRaw)) {
  strategies[k] = { type: "template", template: String(v.template ?? "{{subject}}\n\n{{body_text}}") };
}
if (Object.keys(strategies).length === 0) {
  strategies.default = { type: "template", template: "Subject: {{subject}}\n\n{{body_text}}" };
}
const content_extraction: ContentExtractionCfg = {
  active_strategy: String(ceRaw.active_strategy ?? "default"),
  strategies,
};
```

Return both in the `Config` object.

- [ ] **Step 4: Re-run test — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/backend/config.ts test/backend/config.embedding.test.ts
git commit -m "feat(config): add embedding and content_extraction sections"
```

### Task 3.2: `saveConfig` round-trip + `GET`/`POST /config` routes

- [ ] **Step 1: Write failing test**

Create `test/backend/routes/config.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createConfigRouter } from "../../../src/backend/routes/config";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-"));
  const p = join(dir, "config.toml");
  writeFileSync(p, `
[auth]
credentials_path="/tmp/c"
token_path="/tmp/t"
[llm]
provider="openai"
api_key="old"
model="gpt-4o-mini"
base_url="https://api.openai.com/v1"
`);
  const app = new Hono().route("/", createConfigRouter(p));
  return { app, p };
}

describe("config routes", () => {
  test("GET /config returns current", async () => {
    const { app } = setup();
    const r = await app.request("/config");
    const body = await r.json();
    expect(body.llm.api_key).toBe("old");
  });

  test("POST /config merges + persists llm.api_key", async () => {
    const { app, p } = setup();
    const r = await app.request("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { api_key: "new" } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.llm.api_key).toBe("new");
    expect(readFileSync(p, "utf8")).toContain('api_key = "new"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `saveConfig` in `src/backend/config.ts`**

```ts
import { writeFileSync } from "node:fs";
import { stringify as tomlStringify } from "smol-toml";

export function saveConfig(path: string, cfg: Config): void {
  writeFileSync(path, tomlStringify(cfg as any));
}
```

- [ ] **Step 4: Create `src/backend/routes/config.ts`**

```ts
import { Hono } from "hono";
import { loadConfig, saveConfig } from "../config";

// Deep merge — later source overrides earlier, objects merge recursively.
function deepMerge<T>(base: T, patch: any): T {
  if (typeof base !== "object" || base === null) return patch ?? base;
  if (typeof patch !== "object" || patch === null) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge((base as any)[k], patch[k]);
  }
  return out as T;
}

export function createConfigRouter(configPath: string) {
  const router = new Hono();

  router.get("/config", (c) => {
    return c.json(loadConfig(configPath));
  });

  router.post("/config", async (c) => {
    const patch = await c.req.json();
    const current = loadConfig(configPath);
    const merged = deepMerge(current, patch);
    saveConfig(configPath, merged);
    return c.json(merged);
  });

  return router;
}
```

- [ ] **Step 5: Mount in `server.ts`**

Extend `ServerDeps`:

```ts
export interface ServerDeps {
  db: Database;
  configPath: string;
  // …existing fields
}
```

In `createApp`, after other routes:

```ts
import { createConfigRouter } from "./routes/config";
app.route("/", createConfigRouter(deps.configPath));
```

And in `src/backend/index.ts`, pass `configPath` into `createApp`:

```ts
const app = createApp({ db, configPath, oauth, tokenStore, gmailAdapter, llmProvider, summaryWorker });
```

- [ ] **Step 6: Run tests, expect PASS.**

- [ ] **Step 7: Commit**

```bash
git add src/backend/config.ts src/backend/routes/config.ts src/backend/server.ts src/backend/index.ts test/backend/routes/config.test.ts
git commit -m "feat(config): add GET/POST /config runtime endpoints"
```

---

## Feature 4 — Configurable embedding provider: OpenAI-compatible + local (Phase D) `[source: both]`

**User-facing behavior:** `config.toml` controls which embedding backend runs. `local` loads BGE-M3 via `@huggingface/transformers` (first run downloads + caches); `openai-compatible` calls any OpenAI-shaped `/v1/embeddings` endpoint (including `baseUrl` override for local llama.cpp / vLLM). The hardcoded "mock" tag is removed; the model name is written to a new `embedding_strategies` metadata table (Phase 4b).

**Reference:** `claude/packages/backend/src/services/embed.ts`.

**Files:**
- Create: `src/backend/services/embed-provider.ts` — factory returning `{ embedDocument, embedQuery }`.
- Modify: `src/backend/services/embedding-worker.ts` — use provider, write to `vec_embeddings`, apply active extraction strategy (Feature 5).
- Modify: `src/backend/index.ts` — instantiate provider from config.
- Modify: `package.json` — add `@huggingface/transformers` and `openai`.
- Create: `test/backend/services/embed-provider.test.ts`.
- Modify: `test/backend/embedding-worker.test.ts`.

### Task 4.1: Install deps

- [ ] **Step 1:** `bun add @huggingface/transformers openai`
- [ ] **Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add @huggingface/transformers and openai for embeddings"
```

### Task 4.2: Provider factory (failing test first)

- [ ] **Step 1: Write failing test** `test/backend/services/embed-provider.test.ts`

```ts
import { describe, test, expect } from "bun:test";
import { createEmbedProvider } from "../../../src/backend/services/embed-provider";

describe("createEmbedProvider", () => {
  test("openai-compatible returns documented shape", () => {
    const p = createEmbedProvider({
      provider: "openai-compatible",
      model: "test-model",
      dimension: 4,
      api_key: "sk-fake",
      base_url: "http://localhost:9999/v1",
    });
    expect(typeof p.embedDocument).toBe("function");
    expect(typeof p.embedQuery).toBe("function");
  });

  test("unknown provider throws", () => {
    expect(() =>
      createEmbedProvider({ provider: "bogus" as any, model: "x", dimension: 4 })
    ).toThrow(/provider/);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `src/backend/services/embed-provider.ts`**

```ts
import OpenAI from "openai";
import type { EmbeddingConfig } from "../../shared/types";

export interface EmbedProvider {
  embedDocument(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}

type Extractor = (text: string, opts: { pooling: "mean"; normalize: true }) => Promise<{ data: Float32Array }>;

function loadLocal(model: string): Promise<Extractor> {
  return import("@huggingface/transformers").then(async ({ pipeline }) => {
    return (await pipeline("feature-extraction", model)) as unknown as Extractor;
  });
}

function openAiCompat(cfg: EmbeddingConfig): EmbedProvider {
  const client = new OpenAI({
    apiKey: cfg.api_key ?? "local",
    baseURL: cfg.base_url,
  });
  const embed = async (text: string): Promise<number[]> => {
    const r = await client.embeddings.create({ model: cfg.model, input: text });
    return r.data[0]!.embedding as number[];
  };
  return { embedDocument: embed, embedQuery: embed };
}

function localProvider(cfg: EmbeddingConfig): EmbedProvider {
  let p: Promise<Extractor> | null = null;
  const get = () => (p ??= loadLocal(cfg.model));
  const embed = async (text: string): Promise<number[]> => {
    const ex = await get();
    const out = await ex(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  };
  return { embedDocument: embed, embedQuery: embed };
}

export function createEmbedProvider(cfg: EmbeddingConfig): EmbedProvider {
  if (cfg.provider === "openai-compatible") return openAiCompat(cfg);
  if (cfg.provider === "local") return localProvider(cfg);
  throw new Error(`unknown embedding provider: ${(cfg as any).provider}`);
}
```

Note that `EmbeddingConfig` in `src/shared/types.ts` uses `api_key`/`base_url` (matching TOML snake_case) so the TOML section maps cleanly; the `openai` SDK accepts camelCase `baseURL` which the factory handles.

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/embed-provider.ts test/backend/services/embed-provider.test.ts
git commit -m "feat(embed): pluggable openai-compatible and local providers"
```

### Task 4.3: Rewire worker to use provider + vec0 (depends on Feature 5 strategy — see Task 5.1 first)

(Ordering: implement Feature 5 Task 5.1 before this step so `buildEmbeddingText` exists.)

> **Note:** The existing `test/backend/embedding-worker.test.ts` references the old `embedding BLOB` column which was removed in Phase A (Feature 1). It was left in place with a `describe.skip` annotation. This task removes the skip and rewrites the test for the new vec0-based worker.

- [ ] **Step 1: Rewrite failing test** `test/backend/embedding-worker.test.ts` — remove the `describe.skip`, replace all references to `embedding BLOB` with assertions that `vec_embeddings` now contains one row keyed by the email id.

```ts
import { describe, test, expect } from "bun:test";
import { initDb } from "../../src/backend/db";
import { EmbeddingWorker } from "../../src/backend/services/embedding-worker";

const fakeProvider = {
  embedDocument: async () => new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
  embedQuery: async () => new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
};

const defaultStrategy = { type: "template" as const, template: "{{subject}} {{body_text}}" };

describe("EmbeddingWorker with vec0", () => {
  test("inserts a row into vec_embeddings for each done email without embedding", async () => {
    const db = initDb(":memory:");
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received)
       VALUES ('e1','t','s','hi','body','done',1)`
    );
    const w = new EmbeddingWorker(db, fakeProvider, defaultStrategy, 1024);
    const r = await w.processPending();
    expect(r.processed).toBe(1);
    const row = db.query("SELECT email_id FROM vec_embeddings WHERE email_id = ?").get("e1") as any;
    expect(row?.email_id).toBe("e1");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Rewrite `src/backend/services/embedding-worker.ts`**

```ts
import type Database from "bun:sqlite";
import type { EmbedProvider } from "./embed-provider";
import type { ExtractionStrategy } from "../../shared/types";
import { buildEmbeddingText } from "./extraction-strategies";

export class EmbeddingWorker {
  constructor(
    private db: Database,
    private provider: EmbedProvider,
    private strategy: ExtractionStrategy,
    private dimension: number,
    private batch = 16
  ) {}

  async processPending(): Promise<{ processed: number; failed: number }> {
    // Emails that are summarized (or at least have content) but lack a vec row
    const rows = this.db
      .query(
        `SELECT e.id, e.subject, e.body_text FROM emails e
         LEFT JOIN vec_embeddings v ON v.email_id = e.id
         WHERE v.email_id IS NULL
         ORDER BY e.date_received DESC
         LIMIT ?`
      )
      .all(this.batch * 10) as Array<{ id: string; subject: string; body_text: string | null }>;

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += this.batch) {
      const slice = rows.slice(i, i + this.batch);
      const results = await Promise.allSettled(slice.map((r) => this.one(r)));
      for (const r of results) r.status === "fulfilled" ? processed++ : failed++;
    }
    return { processed, failed };
  }

  private async one(row: { id: string; subject: string; body_text: string | null }): Promise<void> {
    const text = buildEmbeddingText({ subject: row.subject ?? "", bodyText: row.body_text ?? "" }, this.strategy);
    const vec = await this.provider.embedDocument(text);
    if (vec.length !== this.dimension) {
      throw new Error(`embedding dimension ${vec.length} != configured ${this.dimension}`);
    }
    const buf = Buffer.from(new Float32Array(vec).buffer);
    // vec0 has no ON CONFLICT; delete-then-insert in a transaction.
    const tx = this.db.transaction((id: string, b: Buffer) => {
      this.db.run("DELETE FROM vec_embeddings WHERE email_id = ?", [id]);
      this.db.run("INSERT INTO vec_embeddings(email_id, embedding) VALUES (?, ?)", [id, b]);
    });
    tx(row.id, buf);
  }
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Update `src/backend/index.ts`**

```ts
import { createEmbedProvider } from "./services/embed-provider";
import { EmbeddingWorker } from "./services/embedding-worker";

const embedProvider = createEmbedProvider({
  provider: config.embedding.provider,
  model: config.embedding.model,
  dimension: config.embedding.dimension,
  api_key: config.embedding.api_key,
  base_url: config.embedding.base_url,
});
const activeStrategy = config.content_extraction.strategies[config.content_extraction.active_strategy]
  ?? { type: "template", template: "Subject: {{subject}}\n\n{{body_text}}" };
const embeddingWorker = new EmbeddingWorker(
  db,
  embedProvider,
  activeStrategy,
  config.embedding.dimension
);
```

Then pass `embeddingWorker` into `createApp` deps (used by sync routes in Task 4.4).

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/embedding-worker.ts src/backend/index.ts test/backend/embedding-worker.test.ts
git commit -m "feat(embed): rewire worker to use pluggable provider and vec0"
```

### Task 4.4: Trigger embeddings after sync

- [ ] **Step 1:** In `src/backend/routes/sync.ts`, extend `createSyncRouter` to accept an optional `embeddingWorker` and run `embeddingWorker.processPending()` in the same background chain that currently runs `summaryWorker.processPending()`.
- [ ] **Step 2: Commit**

```bash
git add src/backend/routes/sync.ts src/backend/server.ts
git commit -m "feat(sync): trigger embeddings after sync cycle"
```

---

## Feature 5 — User-pluggable extraction strategy templates (Phase D) `[source: both]`

**User-facing behavior:** Users edit `config.toml` → `[content_extraction.strategies.<name>]` with a `template` containing `{{subject}}`/`{{body_text}}` placeholders, then set `active_strategy`. The embedding worker applies the template when constructing the text to embed. Summarization is unaffected.

**Reference:** `claude/packages/backend/src/services/content.ts:17-26` (`buildEmbeddingText`).

**Files:**
- Create: `src/backend/services/extraction-strategies.ts`
- Create: `test/backend/services/extraction-strategies.test.ts`

### Task 5.1: `buildEmbeddingText`

- [ ] **Step 1: Failing test**

```ts
import { describe, test, expect } from "bun:test";
import { buildEmbeddingText } from "../../../src/backend/services/extraction-strategies";

describe("buildEmbeddingText", () => {
  test("replaces {{subject}} and {{body_text}}", () => {
    const out = buildEmbeddingText(
      { subject: "Hi", bodyText: "Hello world" },
      { type: "template", template: "S: {{subject}}\n\n{{body_text}}" }
    );
    expect(out).toBe("S: Hi\n\nHello world");
  });

  test("truncates body to 8000 chars", () => {
    const body = "x".repeat(9000);
    const out = buildEmbeddingText(
      { subject: "", bodyText: body },
      { type: "template", template: "{{body_text}}" }
    );
    expect(out.length).toBe(8000);
  });

  test("handles missing subject gracefully", () => {
    const out = buildEmbeddingText(
      { subject: "", bodyText: "b" },
      { type: "template", template: "{{subject}}|{{body_text}}" }
    );
    expect(out).toBe("|b");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `src/backend/services/extraction-strategies.ts`**

```ts
import type { ExtractionStrategy } from "../../shared/types";

const BODY_MAX_CHARS = 8000;

export function buildEmbeddingText(
  email: { subject: string; bodyText: string },
  strategy: ExtractionStrategy
): string {
  const body = (email.bodyText ?? "").slice(0, BODY_MAX_CHARS);
  return strategy.template
    .replaceAll("{{subject}}", email.subject ?? "")
    .replaceAll("{{body_text}}", body);
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/extraction-strategies.ts test/backend/services/extraction-strategies.test.ts
git commit -m "feat(embed): template-based extraction strategies"
```

---

## Feature 6 — LLM-parsed natural-language search (Phase E) `[source: both]`

**User-facing behavior:** User types `"emails from alice about the invoice last week"`. The LLM parses this into `{ filters: { sender: "alice", date_from: "2026-04-03", date_to: "2026-04-10" }, semanticQuery: "invoice" }`. The backend applies SQL filters for structured pieces and vec0 KNN for the semantic part. Query is combined with existing operator parser: if operators are present, they win; otherwise fall back to LLM parse.

**Reference:** `claude/packages/backend/src/services/ai.ts:22-37, 75-94` and `claude/packages/backend/src/services/search.ts`.

**Files:**
- Modify: `src/backend/llm/provider.ts` — add `parseSearchQuery` method.
- Modify: `src/backend/llm/openai-adapter.ts` and `anthropic-adapter.ts` — implement it.
- Modify: `src/backend/services/search.ts` — add LLM path and vec0 KNN path.
- Create: `test/backend/services/search-llm.test.ts`.

### Task 6.1: Extend `LLMProvider` interface

- [ ] **Step 1: Write the failing test** `test/backend/llm/parse-search.test.ts`

```ts
import { describe, test, expect } from "bun:test";
import { OpenAIAdapter } from "../../../src/backend/llm/openai-adapter";

describe("LLMProvider.parseSearchQuery", () => {
  test("returns ParsedQuery shape", async () => {
    const adapter = new OpenAIAdapter({ apiKey: "sk", model: "gpt-4o-mini", baseUrl: "http://localhost:1" });
    // Stub the private client
    (adapter as any).client = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"filters":{"sender":"alice"},"semanticQuery":"invoice"}' } }] }) } },
    };
    const p = await adapter.parseSearchQuery("from alice about invoice");
    expect(p.filters.sender).toBe("alice");
    expect(p.semanticQuery).toBe("invoice");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Extend `src/backend/llm/provider.ts`**

```ts
export interface ParsedQuery {
  filters: { sender?: string; date_from?: string; date_to?: string; subject?: string };
  semanticQuery: string;
}

export interface LLMProvider {
  summarize(email: { sender: string; subject: string; body: string }): Promise<SummaryResult>;
  parseSearchQuery(query: string): Promise<ParsedQuery>;
}
```

- [ ] **Step 4: Implement in both adapters**

Add to both `openai-adapter.ts` and `anthropic-adapter.ts`:

```ts
async parseSearchQuery(query: string): Promise<ParsedQuery> {
  const prompt = `Parse this email search query. Return ONLY JSON:
{"filters":{"sender":"<omit if absent>","date_from":"<ISO>","date_to":"<ISO>","subject":"<keywords>"},"semanticQuery":"<remaining topic>"}
Today is ${new Date().toISOString().split("T")[0]}.
Query: "${query}"`;
  // provider-specific call, then:
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in LLM response");
  return JSON.parse(match[0]) as ParsedQuery;
}
```

- [ ] **Step 5: Run test — PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/backend/llm/provider.ts src/backend/llm/openai-adapter.ts src/backend/llm/anthropic-adapter.ts test/backend/llm/parse-search.test.ts
git commit -m "feat(llm): add parseSearchQuery to LLM provider"
```

### Task 6.2: Hook LLM parser + vec0 KNN into `SearchService`

- [ ] **Step 1: Failing test** `test/backend/services/search-llm.test.ts`

```ts
import { describe, test, expect } from "bun:test";
import { initDb } from "../../../src/backend/db";
import { SearchService } from "../../../src/backend/services/search";

const llm = {
  parseSearchQuery: async () => ({ filters: { sender: "alice" }, semanticQuery: "" }),
} as any;
const embed = { embedQuery: async () => new Array(1024).fill(0) } as any;

describe("SearchService with LLM parser", () => {
  test("falls back to SQL filter when operators absent", async () => {
    const db = initDb(":memory:");
    db.run(
      `INSERT INTO emails (id, thread_id, sender, subject, date_received) VALUES ('e1','t','alice@x','hi',1),('e2','t','bob@x','bye',2)`
    );
    const svc = new SearchService(db, embed, llm);
    const results = await svc.search("from alice");
    expect(results.map((r) => r.id)).toContain("e1");
    expect(results.map((r) => r.id)).not.toContain("e2");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Modify `src/backend/services/search.ts`**

- Add an optional `llmProvider` constructor arg.
- If the existing operator parser returns an empty filter set **and** `llmProvider` is defined, call `llmProvider.parseSearchQuery(query)` and merge its filters into the `where`/`params` builder. Otherwise keep current behavior.
- Replace `vectorSearch`'s JS-side cosine loop with a vec0 query:

```ts
private async vectorSearch(freeText: string, where: string, params: any[], limit: number): Promise<SearchResult[]> {
  const qvec = await this.embeddingProvider!.embedQuery(freeText);
  const qbuf = Buffer.from(new Float32Array(qvec).buffer);

  // Pull top-K nearest from vec0, then inner-join with SQL filters
  const k = Math.min(Math.max(limit * 10, 50), 500);
  const knn = this.db
    .query("SELECT email_id, distance FROM vec_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance")
    .all(qbuf, k) as Array<{ email_id: string; distance: number }>;

  if (knn.length === 0) return [];
  const ids = knn.map((r) => r.email_id);
  const distMap = new Map(knn.map((r) => [r.email_id, r.distance]));

  const placeholders = ids.map(() => "?").join(",");
  const whereClause = where ? `(${where}) AND id IN (${placeholders})` : `id IN (${placeholders})`;
  const rows = this.db
    .query(
      `SELECT id, thread_id, sender, recipients, subject, date_received, is_read, is_starred, summary
       FROM emails WHERE ${whereClause}`
    )
    .all(...params, ...ids) as any[];

  return rows
    .map((r) => ({ ...r, score: 1 - (distMap.get(r.id) ?? 1), is_read: r.is_read === 1, is_starred: r.is_starred === 1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

- [ ] **Step 4: Wire `llmProvider` in `server.ts` when constructing `SearchService`.**

- [ ] **Step 5: Run tests — PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/search.ts src/backend/server.ts test/backend/services/search-llm.test.ts
git commit -m "feat(search): vec0 KNN + LLM natural-language query parsing"
```

---

## Feature 7 — Summarizer: HTTP 429 backoff (Phase F) `[source: both]`

**User-facing behavior:** When the LLM returns 429, the worker sleeps with exponential backoff (2s → 64s cap) instead of burning the queue and marking everything failed.

**Reference:** `claude/packages/backend/src/services/summarizer.ts:11-48`.

**Files:**
- Modify: `src/backend/services/summary-worker.ts`
- Modify: `test/backend/summary-worker.test.ts`

### Task 7.1: Backoff on 429

- [ ] **Step 1: Add failing test**

```ts
test("backs off on 429 and resets on success", async () => {
  const db = initDb(":memory:");
  db.run(
    `INSERT INTO emails (id, thread_id, sender, subject, body_text, ai_status, date_received) VALUES ('e1','t','s','hi','b','pending',1)`
  );
  let calls = 0;
  const provider = {
    summarize: async () => {
      calls++;
      if (calls === 1) {
        const err: any = new Error("Too Many Requests");
        err.status = 429;
        throw err;
      }
      return { summary: "s", actionItems: [], keyPoints: [], model: "m" };
    },
    parseSearchQuery: async () => ({ filters: {}, semanticQuery: "" }),
  } as any;
  const w = new SummaryWorker(db, provider, 1);
  (w as any).initialBackoffMs = 1;
  (w as any).maxBackoffMs = 4;
  const res = await w.processPending();
  expect(res.processed).toBe(1);
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Modify `summary-worker.ts`**

Replace the `catch (err)` block in `processOne` with 429 detection:

```ts
private initialBackoffMs = 2000;
private maxBackoffMs = 64000;
private backoffMs = 2000;

private is429(e: unknown): boolean {
  return (e as any)?.status === 429;
}

private async processOne(row: {...}): Promise<void> {
  this.db.run("UPDATE emails SET ai_status = 'processing' WHERE id = ?", [row.id]);
  for (;;) {
    try {
      const result = await this.llmProvider.summarize({ sender: row.sender, subject: row.subject, body: row.body_text });
      this.db.run(/* existing update */);
      this.backoffMs = this.initialBackoffMs;
      return;
    } catch (err) {
      if (this.is429(err)) {
        await new Promise((r) => setTimeout(r, this.backoffMs));
        this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
        continue;
      }
      this.db.run("UPDATE emails SET ai_status = 'failed' WHERE id = ?", [row.id]);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/summary-worker.ts test/backend/summary-worker.test.ts
git commit -m "feat(summarizer): exponential backoff on HTTP 429"
```

---

## Feature 8 — `GET /summarizer/status` (Phase F) `[source: both]`

**User-facing behavior:** Clients can poll `/summarizer/status` to see `{ status: "running"|"idle", processed, pending }`.

**Reference:** `claude/packages/backend/src/routes/summarizer.ts`, `claude/packages/backend/src/services/summarizer.ts:50-57`.

**Files:**
- Modify: `src/backend/services/summary-worker.ts` — expose `getStatus(): SummarizerStatus`.
- Create: `src/backend/routes/summarizer.ts`.
- Modify: `src/backend/server.ts`.

### Task 8.1

- [ ] **Step 1: Failing test** `test/backend/routes/summarizer.test.ts` — hits `/summarizer/status`, expects `status` and counts in response body.
- [ ] **Step 2: Add getters to `SummaryWorker`:**

```ts
private processedThisRun = 0;
private statusFlag: "running" | "idle" = "idle";

getStatus(): { status: "running" | "idle"; processed: number; pending: number } {
  return { status: this.statusFlag, processed: this.processedThisRun, pending: this.getQueueDepth() };
}
```

Set `statusFlag` at start / end of `processPending`; increment `processedThisRun` on successful `processOne`.

- [ ] **Step 3: Create `src/backend/routes/summarizer.ts`**

```ts
import { Hono } from "hono";
import type { SummaryWorker } from "../services/summary-worker";

export function createSummarizerRouter(worker: SummaryWorker) {
  const r = new Hono();
  r.get("/summarizer/status", (c) => c.json(worker.getStatus()));
  return r;
}
```

- [ ] **Step 4: Mount in `server.ts` when `summaryWorker` is defined.**
- [ ] **Step 5: Commit**

```bash
git add src/backend/services/summary-worker.ts src/backend/routes/summarizer.ts src/backend/server.ts test/backend/routes/summarizer.test.ts
git commit -m "feat(summarizer): GET /summarizer/status endpoint"
```

---

## Feature 9 — `anchor_unsummarized` inbox flag (Phase F) `[source: both]`

**User-facing behavior:** `GET /emails?anchor_unsummarized=true` returns the page that contains the newest unsummarized email at the top — useful for watching the summarizer catch up.

**Reference:** `claude/packages/backend/src/routes/emails.ts:14-32`.

**Files:**
- Modify: `src/backend/routes/emails.ts`

### Task 9.1

- [ ] **Step 1: Failing test** — seed two emails, mark the newer one `ai_status='done'`, call `GET /emails?anchor_unsummarized=true`, expect the older pending email to be first.
- [ ] **Step 2: Modify handler**

```ts
const anchor = c.req.query("anchor_unsummarized") === "true";
let dateCeiling: number | null = null;
if (anchor) {
  const row = db
    .query("SELECT date_received FROM emails WHERE ai_status = 'pending' AND removed_state IS NULL ORDER BY date_received DESC LIMIT 1")
    .get() as any;
  dateCeiling = row?.date_received ?? null;
}
if (dateCeiling !== null) {
  whereClause += " AND date_received <= ?";
  params.push(dateCeiling);
}
```

- [ ] **Step 3: Run, commit.**

```bash
git add src/backend/routes/emails.ts test/backend/routes/emails.test.ts
git commit -m "feat(emails): anchor_unsummarized=true flag"
```

---

## Feature 10 — On-demand `GET /emails/:id/summary` (Phase F) `[source: both]`

**User-facing behavior:** Client can force summarization of a single email synchronously and get the summary back.

**Reference:** `claude/packages/backend/src/routes/emails.ts:41-46` and `email-ops.ts` `getOrCreateSummary`.

**Files:**
- Modify: `src/backend/routes/emails.ts`

### Task 10.1

- [ ] **Step 1: Failing test** — assert that calling `/emails/:id/summary` on an email with `ai_status='pending'` returns the summary JSON and updates DB to `done`.
- [ ] **Step 2: Inject `llmProvider` into `createEmailRouter` deps.**
- [ ] **Step 3: Implement handler**

```ts
router.get("/emails/:id/summary", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT * FROM emails WHERE id = ?").get(id) as any;
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.summary) return c.json({ description: row.summary, actionItems: JSON.parse(row.action_items ?? "[]"), keyPoints: JSON.parse(row.key_points ?? "[]") });
  if (!llmProvider) return c.json({ error: "llm not configured" }, 503);
  const result = await llmProvider.summarize({ sender: row.sender, subject: row.subject, body: row.body_text });
  db.run(
    `UPDATE emails SET ai_status='done', summary=?, action_items=?, key_points=?, summary_model=?, summary_generated_at=? WHERE id=?`,
    [result.summary, JSON.stringify(result.actionItems), JSON.stringify(result.keyPoints), result.model, Date.now(), id]
  );
  return c.json({ description: result.summary, actionItems: result.actionItems, keyPoints: result.keyPoints });
});
```

- [ ] **Step 4: Run, commit.**

```bash
git add src/backend/routes/emails.ts src/backend/server.ts test/backend/routes/emails.test.ts
git commit -m "feat(emails): on-demand GET /emails/:id/summary"
```

---

## Feature 11 — `DELETE /auth/logout` (Phase G) `[source: both]`

**User-facing behavior:** Logging out revokes the refresh token via Google's revocation endpoint and deletes the local token file. Subsequent `/auth/status` reports `authorized: false`.

**Reference:** `claude/packages/backend/src/routes/auth.ts:24-27`.

**Files:**
- Modify: `src/backend/routes/auth.ts`
- Modify: `src/backend/auth/token-store.ts` (ensure `clear()` exists) and `src/backend/auth/oauth.ts` (ensure `revoke()` exists; if not, add a call to `https://oauth2.googleapis.com/revoke?token=<refresh_token>`).

### Task 11.1

- [ ] **Step 1: Failing test** — create token, call `DELETE /auth/logout`, verify token file removed and `/auth/status` returns `authorized: false`.
- [ ] **Step 2: Add handler**

```ts
router.delete("/auth/logout", async (c) => {
  const tokens = tokenStore.load();
  if (tokens?.refresh_token && oauth) {
    try { await oauth.revoke(tokens.refresh_token); } catch { /* revoke best-effort */ }
  }
  tokenStore.clear();
  return c.json({ ok: true });
});
```

If `tokenStore.clear` / `oauth.revoke` do not exist, add them: `clear()` should `rmSync` the token file if present; `revoke()` should `fetch("https://oauth2.googleapis.com/revoke?token=" + token, { method: "POST" })`.

- [ ] **Step 3: Run, commit.**

```bash
git add src/backend/routes/auth.ts src/backend/auth/token-store.ts src/backend/auth/oauth.ts test/backend/routes/auth.test.ts
git commit -m "feat(auth): DELETE /auth/logout endpoint"
```

---

## Feature 12 — Older-than backfill as step 3 of the sync cycle (Phase G) `[source: both]`

**User-facing behavior:** After step 1 (newest) and step 2 (gap fill), if budget remains and there are no open gaps, fetch messages older than the current oldest known `date_received` to extend history backward.

**Reference:** `claude/packages/backend/src/services/sync.ts:100-120`, `claude/packages/backend/src/services/gmail.ts` (`fetchMessagesBefore`).

**Files:**
- Modify: `src/backend/gmail/adapter.ts` or wherever the `listMessages` call lives — add an optional `before:<unix>` Gmail search operator.
- Modify: `src/backend/services/sync.ts` — add step 3 within `syncNewest`.
- Modify: `src/backend/services/gap-manager.ts` — expose `hasOpenGaps(): boolean` if not already.

### Task 12.1

- [ ] **Step 1: Failing test** `test/backend/sync.older-than.test.ts` — seed an email at `date_received=1000`, a mock adapter that returns an email at `date_received=500` when called with `before: 1000`, call `syncNewest(10)`, expect both rows present afterward.
- [ ] **Step 2: Add adapter support**

In `GmailApiClient.listMessages`, forward an optional `before?: number` → Gmail query `before:<unix-seconds>`.

- [ ] **Step 3: Extend `SyncService.syncNewest`**

After the existing gap-fill block, before the `return`:

```ts
if (!this.gapManager.hasOpenGaps()) {
  const remaining = batchSize - fetched - skipped - gapFilled;
  if (remaining > 0) {
    const oldestRow = this.db
      .query("SELECT MIN(date_received) AS d FROM emails WHERE removed_state IS NULL")
      .get() as { d: number | null };
    if (oldestRow.d != null) {
      const beforeSec = Math.floor(oldestRow.d / 1000);
      const olderResult = await this.adapter.listMessages({
        maxResults: remaining,
        labelIds: ["INBOX"],
        before: beforeSec,
      });
      for (const msg of olderResult.messages) { /* same insert loop as step 1 */ }
    }
  }
}
```

- [ ] **Step 4: Run, commit.**

```bash
git add src/backend/gmail/adapter.ts src/backend/gmail/gmail-api.ts src/backend/services/sync.ts src/backend/services/gap-manager.ts test/backend/sync.older-than.test.ts
git commit -m "feat(sync): older-than backfill as step 3 of sync cycle"
```

---

## Feature 13 — Web client: React + Vite inbox / preview / search (Phase H) `[source: both]`

**User-facing behavior:** Browser UI served separately on a Vite dev server. Shows paginated inbox list, email preview with three modes (summary / text / HTML iframe), and a search bar that hits `POST /search` (or `GET /search?q=`). Actions: archive, delete. Talks to backend via `VITE_API_BASE_URL`.

**Reference:** `claude/packages/web/src/{App.tsx,api.ts,main.tsx,components/EmailList.tsx,components/EmailPreview.tsx,components/SearchBar.tsx}`.

**Location in glm:** A new top-level `web/` directory (sibling of `src/`), its own `package.json`, so it does not pollute the Bun project. glm's CLAUDE.md already describes a single-package Bun project; the web client will have its own npm-ish install step (using Bun's `bun install` against its own package.json is fine since Bun can drive Vite).

**API contract:** The web client imports types from `../src/shared/types.ts` via a `paths`/relative import so there is no duplication. Backend endpoints it uses: `GET /emails`, `GET /emails/:id`, `GET /emails/:id/summary`, `POST /emails/:id/archive`, `POST /emails/:id/delete`, `POST /search`, `GET /search?q=`, `GET /auth/status`.

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api.ts`
- Create: `web/src/components/EmailList.tsx`
- Create: `web/src/components/EmailPreview.tsx`
- Create: `web/src/components/SearchBar.tsx`
- Create: `web/src/api.test.ts`

### Task 13.1: Scaffold Vite project

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "gmail-sweep-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/react": "^14.3.1",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/emails": "http://localhost:3000",
      "/search": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/sync": "http://localhost:3000",
      "/summarizer": "http://localhost:3000",
      "/config": "http://localhost:3000",
    },
  },
  test: { environment: "jsdom" },
});
```

- [ ] **Step 3: `web/tsconfig.json` with `paths: { "@shared/*": ["../src/shared/*"] }`** so the web client imports types from the backend's shared module.

- [ ] **Step 4: `web/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Gmail Sweep</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 5:** `cd web && bun install`
- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html
git commit -m "chore(web): scaffold Vite + React client"
```

### Task 13.2: API client + type-safe fetch

- [ ] **Step 1: Write failing test** `web/src/api.test.ts`

```ts
import { describe, test, expect, vi } from "vitest";
import { createApi } from "./api";

describe("api.listEmails", () => {
  test("calls /emails?limit=50 and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ emails: [{ id: "1" }], total: 1 }),
    });
    const api = createApi("", fetchMock as any);
    const r = await api.listEmails({ limit: 50 });
    expect(r.emails[0].id).toBe("1");
    expect(fetchMock).toHaveBeenCalledWith("/emails?limit=50");
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `web/src/api.ts`**

```ts
import type { Email } from "@shared/types";

export interface EmailListResponse { emails: Email[]; total: number; }

export function createApi(base = "", fetchImpl: typeof fetch = fetch) {
  const j = async <T>(r: Response): Promise<T> => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<T>;
  };
  return {
    listEmails: (opts: { limit?: number; offset?: number; unread?: boolean; label?: string; anchor_unsummarized?: boolean }) => {
      const q = new URLSearchParams();
      if (opts.limit) q.set("limit", String(opts.limit));
      if (opts.offset) q.set("offset", String(opts.offset));
      if (opts.unread !== undefined) q.set("unread", String(opts.unread));
      if (opts.label) q.set("label", opts.label);
      if (opts.anchor_unsummarized) q.set("anchor_unsummarized", "true");
      return fetchImpl(`${base}/emails?${q.toString()}`).then(j<EmailListResponse>);
    },
    getEmail: (id: string) => fetchImpl(`${base}/emails/${id}`).then(j<Email>),
    archive: (id: string) => fetchImpl(`${base}/emails/${id}/archive`, { method: "POST" }).then(j<{ success: boolean }>),
    delete: (id: string) => fetchImpl(`${base}/emails/${id}/delete`, { method: "POST" }).then(j<{ success: boolean }>),
    search: (query: string) => fetchImpl(`${base}/search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    }).then(j<{ results: Email[] }>),
  };
}
```

- [ ] **Step 4: Run test — PASS.**
- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): typed api client"
```

### Task 13.3: `EmailList`, `EmailPreview`, `SearchBar`, `App`

- [ ] **Step 1:** Port each component from `claude/packages/web/src/components/*.tsx`, rewriting prop types to use the glm `Email` type (with snake_case fields like `body_text`, `date_received`). Keep the same three-mode preview (summary/text/HTML iframe via `sandbox="allow-same-origin"`).

- [ ] **Step 2:** `App.tsx` composes: left column `EmailList` (calls `api.listEmails`), right column `EmailPreview` (selected email), top bar `SearchBar` (switches the list source to `api.search`). Keyboard shortcuts: `Tab` cycles preview mode, `a` archive, `d` delete, `/` focus search.

- [ ] **Step 3:** `main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4:** Add one render smoke test per component using `@testing-library/react` — assert list renders subject strings, preview renders summary when mode=summary, iframe renders when mode=html and `body_html` present.

- [ ] **Step 5: Run `cd web && bun run test` and `bun run build` — both PASS.**

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/main.tsx web/src/components
git commit -m "feat(web): inbox list, preview, and search bar components"
```

---

## Feature 14 — HTML-rendered email preview (sandboxed iframe) `[source: both]`

Already covered by Feature 13, Task 13.3. No separate tasks. The sandbox attribute is `sandbox="allow-same-origin"` (no `allow-scripts`), matching claude's EmailPreview.tsx:83-87 and preventing arbitrary JS execution from email bodies.

---

## Feature 15 — Email list filters (sender/date/subject/pagination) + inbox-only default (Phase F/G) `[source: codex]`

**User-facing behavior:** `GET /emails` accepts `?sender=`, `?date_from=` (unix seconds), `?date_to=`, `?subject=` (LIKE), `?limit=`, `?offset=`. Default listing is restricted to messages whose Gmail `labels` JSON array contains `INBOX` (in addition to the existing `removed_state IS NULL` check), matching claude's behavior — archived mail no longer shows in the default inbox view.

**Why mainline (not nice-to-have):** The inbox-only default is a correctness gap (archived mail leaking into the inbox list is a user-visible defect), and the filters are user-facing list controls that the web client in Feature 13 will want.

**Reference:** `claude/packages/backend/src/routes/emails.ts`, `claude/packages/backend/src/services/db.ts` `listEmails()` (`labels LIKE '%INBOX%'`), `claude/packages/shared/src/types.ts` `ListEmailsQuery`.

**Files:**
- Modify: `src/backend/routes/emails.ts` — parse new query params, forward to db layer.
- Modify: `src/backend/db/` email list query builder — append `AND labels LIKE '%"INBOX"%'` to the default `where`; append optional `sender`, `subject`, `date_received >= ?`, `date_received <= ?`, plus `LIMIT ? OFFSET ?`.
- Modify: `src/shared/types.ts` (from Feature 2) — extend `ListEmailsQuery` with the new fields.
- Modify: `test/backend/routes/emails.test.ts`

### Task 15.1: Inbox-only default filter

- [ ] **Step 1: Failing test** — seed three emails: `e1 labels=["INBOX"]`, `e2 labels=["CATEGORY_PROMOTIONS"]` (no INBOX), `e3 labels=["INBOX","UNREAD"]`. Call `GET /emails` with no params. Expect `e1` and `e3` in result, `e2` absent.

- [ ] **Step 2: Run test — FAIL** (currently `e2` appears because only `removed_state IS NULL` is checked).

- [ ] **Step 3: Add INBOX filter to the default list query**

```ts
// src/backend/routes/emails.ts (or db query builder)
const where: string[] = ["removed_state IS NULL", "labels LIKE '%\"INBOX\"%'"];
```

Use the JSON-quoted form `"INBOX"` to avoid matching substrings like `INBOXED`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/backend/routes/emails.ts test/backend/routes/emails.test.ts
git commit -m "fix(emails): restrict default /emails listing to INBOX label"
```

### Task 15.2: `sender`, `date_from`, `date_to`, `subject`, `limit`, `offset` params

- [ ] **Step 1: Failing test** — seed five emails across two senders and a 10-day date range. Assert:
  - `?sender=alice@x.com` → only alice rows.
  - `?date_from=1700000000&date_to=1700500000` → only rows in that window.
  - `?subject=invoice` → only rows whose subject contains `invoice` (case-insensitive).
  - `?limit=2&offset=1` → exactly 2 rows starting from the second.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Extend the query builder**

```ts
const q = c.req.query();
if (q.sender) { where.push("sender = ?"); params.push(q.sender); }
if (q.date_from) { where.push("date_received >= ?"); params.push(Number(q.date_from)); }
if (q.date_to) { where.push("date_received <= ?"); params.push(Number(q.date_to)); }
if (q.subject) { where.push("subject LIKE ? COLLATE NOCASE"); params.push(`%${q.subject}%`); }
const limit = Math.min(Number(q.limit ?? 100), 500);
const offset = Number(q.offset ?? 0);
// ... ORDER BY date_received DESC LIMIT ? OFFSET ?
params.push(limit, offset);
```

- [ ] **Step 4: Extend `ListEmailsQuery` in `src/shared/types.ts`**

```ts
export interface ListEmailsQuery {
  unread?: boolean;
  label?: string;
  anchor_unsummarized?: boolean;
  sender?: string;
  date_from?: number;
  date_to?: number;
  subject?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/backend/routes/emails.ts src/shared/types.ts test/backend/routes/emails.test.ts
git commit -m "feat(emails): sender/date/subject/pagination filters on /emails"
```

---

## Feature 16 — Display search result scores in clients (Phase E/H) `[source: codex]`

**User-facing behavior:** When a result comes from vector search, each row in the TUI and web client shows the relevance score (e.g. `0.82`) next to the subject. Keyword-only results omit the score.

**Why mainline:** Trivial polish on top of Features 6 and 13 — vec0 KNN already returns a distance, which Feature 6 exposes as `score` on the `SearchResult` type.

**Reference:** `claude/packages/terminal/src/views/search.ts`, `claude/packages/web/src/components/SearchBar.tsx`.

**Files:**
- Modify: `src/shared/types.ts` — ensure `SearchResult` has optional `score?: number`.
- Modify: `src/tui/components/email-list.ts` (or wherever search result rows render) — append `score?.toFixed(2)` if present.
- Modify: `web/src/components/SearchBar.tsx` and/or `EmailList.tsx` — show `score` badge.
- Modify: `test/backend/services/search.test.ts` — assert `score` is populated for vector results.

### Task 16.1: Score propagation end-to-end

- [ ] **Step 1: Failing test** — in `test/tui/email-list-render.test.ts` (or wherever TUI rendering is tested) assert that when given `{ id, subject, score: 0.82 }`, the rendered row string contains `0.82`. For web: snapshot test `<EmailList>` with `score=0.82` contains `0.82`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Thread `score` through**

- Confirm `SearchService.vectorSearch()` (rewritten in Task 6.2) sets `score = 1 - distance` on each result. Already true in the Task 6.2 snippet — verify.
- In `src/tui/components/email-list.ts`, if the row has a `score` field, format the row as `` `${subject} [${score.toFixed(2)}]` ``.
- In `web/src/components/EmailList.tsx`, render `{email.score != null && <span className="score">{email.score.toFixed(2)}</span>}`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/tui/components/email-list.ts web/src/components/EmailList.tsx test/tui/email-list-render.test.ts
git commit -m "feat(ui): display vector-search relevance scores in tui and web"
```

---

## Feature 17 — Terminal command to load inbox anchored at newest unsummarized (Phase F) `[source: codex]`

**User-facing behavior:** In the TUI, a keystroke (`L`, matching claude's terminal `L` binding) reloads the email list using `anchor_unsummarized=true`, so the view jumps to the oldest window that still contains a pending summary. Complements Feature 9 (backend) — without this, the flag is not reachable from glm's TUI.

**Not covered elsewhere:** Feature 9 only adds the backend query flag. Plan previously had no terminal-side task. This adds it.

**Reference:** `claude/packages/terminal/src/index.ts` (`l` / `L` keybinding), `claude/packages/terminal/src/api.ts`.

**Files:**
- Modify: `src/tui/api.ts` — `listEmails()` already takes a query object; add `anchor_unsummarized?: boolean`.
- Modify: `src/tui/app.ts` — register `L` keypress handler that reloads with `{ anchor_unsummarized: true }`.
- Modify: `test/tui/app-keybindings.test.ts` (create if absent).

### Task 17.1

- [ ] **Step 1: Failing test** — mock `api.listEmails`, simulate pressing `L`, assert it was called with `{ anchor_unsummarized: true }`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Wire the keybinding**

```ts
// src/tui/app.ts — inside key setup
screen.key(["L"], async () => {
  const emails = await api.listEmails({ anchor_unsummarized: true });
  this.setEmails(emails);
  this.render();
});
```

- [ ] **Step 4: Update `api.listEmails` signature in `src/tui/api.ts`** to forward the param as `?anchor_unsummarized=true`.

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/tui/app.ts src/tui/api.ts test/tui/app-keybindings.test.ts
git commit -m "feat(tui): L keybinding to anchor inbox at newest unsummarized"
```

---

## Phase I — Nice-to-haves

These are implementation-level niceties not in the original user-facing scope. Each is independent; skip any or all without affecting earlier phases.

---

## Feature 18 — Auth callback redirects to frontend with query params `[nice-to-have]` `[source: codex]`

**User-facing behavior:** `GET /auth/callback?code=...` exchanges the code for tokens and then issues an HTTP 302 redirect to the frontend (e.g. `http://localhost:5173/?auth=ok` on success, `?auth=error&reason=...` on failure) instead of returning raw JSON. Matches claude's browser-flow UX.

**Reference:** `claude/packages/backend/src/routes/auth.ts`.

**Files:**
- Modify: `src/backend/routes/auth.ts`
- Modify: `src/backend/config.ts` — add `frontendUrl` (default `http://localhost:5173`).

### Task 18.1

- [ ] **Step 1: Failing test** — request `/auth/callback?code=FAKE`, expect status 302 and `Location` header starting with `http://localhost:5173/?auth=`.

- [ ] **Step 2: Modify handler**

```ts
router.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const frontend = config.frontendUrl ?? "http://localhost:5173";
  if (!code) return c.redirect(`${frontend}/?auth=error&reason=missing_code`, 302);
  try {
    const tokens = await oauth.exchangeCode(code);
    tokenStore.save(tokens);
    return c.redirect(`${frontend}/?auth=ok`, 302);
  } catch (e: any) {
    return c.redirect(`${frontend}/?auth=error&reason=${encodeURIComponent(e.message)}`, 302);
  }
});
```

- [ ] **Step 3: Run, commit.**

```bash
git add src/backend/routes/auth.ts src/backend/config.ts test/backend/routes/auth.test.ts
git commit -m "feat(auth): redirect /auth/callback to frontend with status query"
```

---

## Feature 19 — `/auth/status` includes authenticated email address `[nice-to-have]` `[source: codex]`

**User-facing behavior:** `GET /auth/status` returns `{ authorized: true, email: "alice@example.com" }` (or `{ authorized: false }`). The email is fetched from Gmail's `users.getProfile` on the first authorized status call and cached in memory for the process lifetime.

**Reference:** `claude/packages/backend/src/routes/auth.ts`, `claude/packages/backend/src/services/gmail.ts` `getProfile()`.

**Files:**
- Modify: `src/backend/routes/auth.ts`
- Modify: `src/backend/gmail/adapter.ts` — add `getProfile()` returning `{ emailAddress }`.

### Task 19.1

- [ ] **Step 1: Failing test** — stub `gmailAdapter.getProfile` to return `{ emailAddress: "alice@x" }`, call `/auth/status`, expect `{ authorized: true, email: "alice@x" }`.

- [ ] **Step 2: Add adapter method**

```ts
// src/backend/gmail/adapter.ts
async getProfile(): Promise<{ emailAddress: string }> {
  const res = await this.api.get("/gmail/v1/users/me/profile");
  return { emailAddress: res.emailAddress };
}
```

- [ ] **Step 3: Modify `/auth/status` handler** to call `getProfile()` when authorized (wrap in try/catch; fall back to `{ authorized: true }` on error). Cache the result in a module-level variable keyed by refresh-token prefix.

- [ ] **Step 4: Run, commit.**

```bash
git add src/backend/routes/auth.ts src/backend/gmail/adapter.ts test/backend/routes/auth.test.ts
git commit -m "feat(auth): include authenticated email in /auth/status"
```

---

## Feature 20 — Config file auto-created with defaults when missing `[nice-to-have]` `[source: codex]`

**User-facing behavior:** On first run, if the TOML config file at the configured path does not exist, write a default TOML with sane empty scaffolding (empty LLM/embedding blocks, default frontendUrl, etc.) and continue startup instead of throwing.

**Reference:** `claude/packages/backend/src/config.ts` — auto-create branch.

**Files:**
- Modify: `src/backend/config.ts`

### Task 20.1

- [ ] **Step 1: Failing test** — point the loader at a nonexistent path (`/tmp/glm-config-${Date.now()}.toml`), call `loadConfig(path)`, expect no throw, expect file now exists with default content parseable as TOML.

- [ ] **Step 2: Modify `loadConfig`**

```ts
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_CONFIG_TOML = `# gmail-sweep config (auto-generated)
frontendUrl = "http://localhost:5173"

[llm]
provider = ""
apiKey = ""
model = ""

[embedding]
provider = ""
apiKey = ""
model = ""
`;

export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, DEFAULT_CONFIG_TOML);
  }
  // ... existing parse logic
}
```

- [ ] **Step 3: Run, commit.**

```bash
git add src/backend/config.ts test/backend/config.test.ts
git commit -m "feat(config): auto-create default TOML config when missing"
```

---

## Feature 21 — Google credential environment variable overrides `[nice-to-have]` `[source: codex]`

**User-facing behavior:** If `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and/or `GOOGLE_REDIRECT_URI` are set in the environment, they override the corresponding fields loaded from `config.toml`. Lets deployments inject credentials without editing the TOML.

**Reference:** `claude/packages/backend/src/config.ts` — env override branch.

**Files:**
- Modify: `src/backend/config.ts`

### Task 21.1

- [ ] **Step 1: Failing test** — load config from a TOML with `googleClientId = "from-toml"`, then set `process.env.GOOGLE_CLIENT_ID = "from-env"` before calling `loadConfig`, expect returned config `.googleClientId === "from-env"`.

- [ ] **Step 2: Modify `loadConfig`** (after parsing TOML, before returning):

```ts
if (process.env.GOOGLE_CLIENT_ID) config.googleClientId = process.env.GOOGLE_CLIENT_ID;
if (process.env.GOOGLE_CLIENT_SECRET) config.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (process.env.GOOGLE_REDIRECT_URI) config.googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;
```

- [ ] **Step 3: Run, commit.**

```bash
git add src/backend/config.ts test/backend/config.test.ts
git commit -m "feat(config): GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI env overrides"
```

---

## Skipped items

Items present in the comparison docs that are intentionally NOT ported, because glm already has equivalent functionality in a different shape (or the source worktree has a bug we shouldn't import):

- **`/sync` synchronous-with-counts contract** `[source: codex]` — glm's `/sync` is fire-and-forget returning `202` with an in-memory route mutex; this is an equivalent feature in a different shape. Keeping glm's contract.
- **Date-boundary gap tracking** `[source: both]` — glm uses pageToken-based gap tracking, which is an equivalent mechanism in a different shape. No port.
- **Claude bug: trashed emails reappear on reload** `[source: codex]` — defect only affects claude (its `trashEmail()` leaves `INBOX` on the row). glm uses `removed_state IS NULL` and is not affected. No task.
- **Claude bug: sync not restricted to `INBOX`** `[source: codex]` — glm already passes `labelIds: ["INBOX"]` to the Gmail API in `sync.ts` / `gap-manager.ts`. Nothing to port.
- **`EmbeddingWorker` wiring gap** `[source: codex]` — glm has `EmbeddingWorker` / `vectorSearch` code but `src/backend/index.ts` never constructs them. Superseded by Feature 4 Task 4.4 and Feature 6 Task 6.2, which wire the new provider + vec0 search into `index.ts` / `server.ts`. Verify during those tasks that `index.ts` constructs and starts the worker.

---

## Known-bug note (glm `vectorSearch` Float64 decode)

The current broken decode in `src/backend/services/search.ts:107` is **deleted** as part of Feature 6 (search rewrite) / Feature 1 (vec0 migration). After Phase A the `emails.embedding` column no longer exists, so there is nothing to decode; after Phase E the JS-side cosine path is replaced with a vec0 `MATCH … AND k = ?` query. No separate fix task is needed — just verify when you delete the old `vectorSearch` body that no caller still references `row.embedding` buffers.

---

## Self-review checklist

- **Spec coverage:** 21 features enumerated → Feature 1 (sqlite-vec), 2 (shared types), 3 (config endpoints), 4 (embed provider), 5 (extraction strategies), 6 (LLM search), 7 (429 backoff), 8 (summarizer status), 9 (anchor_unsummarized backend), 10 (on-demand summary), 11 (logout), 12 (older-than), 13 (web client), 14 (HTML iframe — folded into 13), 15 (email list filters + inbox-only default, codex), 16 (search scores in UI, codex), 17 (TUI anchor-unsummarized keybinding, codex), 18 (auth callback redirect, nice-to-have), 19 (auth status email, nice-to-have), 20 (config auto-create, nice-to-have), 21 (Google env overrides, nice-to-have). All present.
- **Source tags:** every feature carries a `[source: claude|codex|both]` marker; nice-to-haves additionally carry `[nice-to-have]`.
- **Bug note:** Float64/Float32 bug called out and tied to Phase A.
- **Ordering:** Phases A→H explicitly ordered; Task 4.3 depends on Task 5.1 — called out.
- **Stack differences:** Extension loading, TOML persistence, shared types, web location all addressed up front.
- **File paths:** All absolute inside the glm worktree (`src/backend/...`, `test/backend/...`, `web/...`).
- **References:** Each feature cites `claude/packages/...` paths for the implementing agent to consult.

---

## Execution handoff

Plan saved to `/home/ckolbegger/src/gmail-sweep/worktrees/glm/docs/plan-port-claude-features-to-glm.md`. Two execution options:

1. **Subagent-driven (recommended)** — dispatch fresh subagent per task, review between tasks.
2. **Inline execution** — executing-plans with batch checkpoints.

Which approach?
