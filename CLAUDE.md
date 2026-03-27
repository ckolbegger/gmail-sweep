# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

All implementation work lives in the `claude` git worktree at `~/src/gmail-sweep/worktrees/claude/`. The git root (`~/src/gmail-sweep/`) is the bare repo — do not work there. All paths below are relative to the worktree root.

npm workspaces monorepo with four packages:

- `packages/shared` — TypeScript types only; the API contract between all packages
- `packages/backend` — Fastify server (port 3141); owns all business logic, Gmail API, SQLite, LLM
- `packages/terminal` — OpenTUI client; thin HTTP consumer
- `packages/web` — React + Vite client; thin HTTP consumer

## Commands

```bash
# Run all tests (note: `npm test --workspaces` fails — vitest not in PATH; use npx per package)
npx vitest run                          # from within a package directory

# Per-package tests
cd packages/backend && npx vitest run
cd packages/terminal && npx vitest run
cd packages/web && npx vitest run

# Run a single test file
cd packages/backend && npx vitest run src/services/db.test.ts

# Dev server (backend with hot reload via --watch)
npm run dev:backend                     # from worktree root

# Build all packages
npm run build                           # from worktree root

# Build a single package
cd packages/backend && npm run build
```

Backend dev mode uses `node --watch --experimental-strip-types` — no separate compile step needed.

## Architecture

### Backend service pattern

Services are plain functions/objects, not classes. Each service file exports a `create*` factory function returning an interface (e.g., `DbHandle`, `GmailService`, `AiService`, `EmbedService`). Services are wired together in `server.ts` — the only place that knows about all dependencies.

Routes receive their dependencies as Fastify plugin options (not imported directly). Tests instantiate services directly with in-memory/temp DBs.

### Data flow for a sync cycle

`POST /sync` → `syncRoutes` → `runSyncCycle(db, gmail, options)` → after sync, `generatePendingEmbeddings(db, embedService, strategyId, strategy, batchLimit)` runs to embed new emails.

### Search pipeline

`POST /search` → `SearchService.search(query)` → AI parses natural language into `{ filters, semanticQuery }` → SQL query with sender/date/subject filters → vector cosine similarity on remaining candidates using `sqlite-vec`.

Embeddings are stored as `BLOB` (float32 LE) in `email_embeddings(email_id, strategy)`. The `email_embeddings` table is separate from `emails` to support multiple embedding strategies per email.

### Config and credentials

Runtime config is loaded from `~/.gmail-sweep/config.json` via `loadConfig()` in `packages/backend/src/config.ts`. Google OAuth2 credentials can also be loaded from a `.env` file in `packages/backend/`.

### Shared types

All request/response types live in `packages/shared/src/types.ts`. Clients must never define their own API types — import from `@gmail-sweep/shared`.

### HTML email handling

During sync, `body_text` is always populated (from `text/plain` part, or converted from `text/html` via `html-to-text`). AI summaries and embeddings always use `body_text`. The web client renders `body_html` in a sandboxed iframe; the terminal always uses `body_text`.
