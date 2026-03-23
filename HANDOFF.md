# gmail-sweep — Session Handoff

This document brings a new Claude Code session up to speed on the gmail-sweep project.

## What We're Building

A terminal-first Gmail client (`gmail-sweep`) with AI-powered inbox management. Key features:
- Split-pane terminal UI (OpenTUI) with email list + preview pane
- AI summary (one-sentence description, action items, key points)
- Natural language vector search ("find emails about upcoming events")
- One-key archive (`a`) and delete (`d`)
- Refresh/sync with gap-aware cursor-based sync algorithm
- Web client (React + Vite) with full parity, same backend

## Repository Layout

```
/home/ckolbegger/src/gmail-sweep/       ← project root (git repo, master branch)
  .gitignore                            ← includes worktrees/ and .superpowers/
  worktrees/
    claude/                             ← git worktree on 'claude' branch — all work lives here
      docs/
        superpowers/
          specs/
            2026-03-23-gmail-sweep-design.md   ← APPROVED design spec
          plans/
            2026-03-23-gmail-sweep-backend.md  ← APPROVED Plan 1 (backend)
      HANDOFF.md                        ← this file
```

All implementation work goes into `worktrees/claude/` (the `claude` git branch).

## Architecture (from spec)

```
Terminal (OpenTUI)  or  Web (React + Vite)
        ↓ HTTP / REST
  Backend (Fastify, port 3141)
    ├── SQLite (better-sqlite3)    emails, sync state, gaps
    ├── sqlite-vec                 vector embeddings for search
    ├── Gmail API (googleapis)     OAuth2, sync, archive, delete
    └── LLM Provider               Anthropic / OpenAI / Ollama / LMStudio
```

**npm workspaces monorepo** with four packages:
- `packages/backend` — Fastify HTTP server (all business logic)
- `packages/terminal` — OpenTUI client (thin HTTP consumer)
- `packages/web` — React + Vite client (thin HTTP consumer)
- `packages/shared` — TypeScript types, API contract

## Key Design Decisions

- **Backend owns everything**: Gmail API, SQLite, LLM. Clients are thin HTTP consumers.
- **`packages/shared` is the API contract**: clients import types from there, never define their own.
- **Gap-aware sync**: cursor-based fetch (newest → fill gaps → fetch older), tracked in `sync_gaps` table.
- **Semantic-only embeddings**: subject + body text only (no sender/date — those are SQL-indexed columns).
- **AI-parsed search**: natural language → LLM extracts structured filters + semantic query → SQL filter first, then vector rank.
- **Provider-agnostic AI**: Anthropic for chat/summaries; OpenAI-compatible for embeddings (Anthropic has no embedding models). Ollama/LMStudio supported via custom `baseUrl`.
- **HTML emails**: converted to `body_text` during sync via `html-to-text`. Terminal always uses `body_text`. Web renders `body_html` in sandboxed iframe.
- **Configurable extraction pipeline**: embedding strategies are named/versioned (`v1-plain`, etc.) — supports A/B trials. Stored in `~/.gmail-sweep/config.json`.
- **Embeddings stored as BLOB**: `email_embeddings` table with `(email_id, strategy)` composite PK; cosine similarity computed in-process.

## What's Done

- [x] Design brainstorming (completed)
- [x] Design spec written and reviewed: `docs/superpowers/specs/2026-03-23-gmail-sweep-design.md`
- [x] Backend implementation plan written and reviewed: `docs/superpowers/plans/2026-03-23-gmail-sweep-backend.md`

## What's Next: Execute Plan 1 (Backend)

**The next step is to execute the backend plan.** Use the `superpowers:executing-plans` or `superpowers:subagent-driven-development` skill.

Plan file: `docs/superpowers/plans/2026-03-23-gmail-sweep-backend.md`

The plan covers 12 tasks in order:
1. Monorepo root setup (package.json, tsconfig.base.json)
2. Shared types package (`packages/shared`)
3. Backend package skeleton (Fastify + vitest)
4. Config service (`~/.gmail-sweep/config.json`)
5. Database service (SQLite schema, CRUD, gap management)
6. Content extraction (HTML-to-text, embedding text builder)
7. AI service (Anthropic, OpenAI, OpenAI-compatible)
8. Gmail service + OAuth2
9. Sync service (gap-aware algorithm)
10. Search service (AI query parsing + SQL filter + vector rank)
10.5. Post-sync embedding generation
11. REST routes (auth, emails, sync, search, config)
12. Integration smoke test

**All code goes into `worktrees/claude/`** (i.e., the files created will be at paths like `worktrees/claude/packages/backend/src/...`). Commits go to the `claude` branch.

## Plans 2 and 3 (Not Yet Written)

After Plan 1 is complete:
- **Plan 2**: Terminal client (OpenTUI) — split-pane inbox, preview pane, key bindings
- **Plan 3**: Web client (React + Vite) — full parity, HTML rendering in sandboxed iframe

## Config Reference

User config lives at `~/.gmail-sweep/config.json` (created by backend on first run):
```json
{
  "google": { "clientId": "", "clientSecret": "", "redirectUri": "http://localhost:3141/auth/callback" },
  "llm": { "provider": "anthropic", "model": "claude-sonnet-4-6", "apiKey": "..." },
  "embedding": { "provider": "openai", "model": "text-embedding-3-small", "apiKey": "...", "dimension": 1536 },
  "sync": { "defaultBatchSize": 500 },
  "contentExtraction": { "activeStrategy": "v1-plain", "strategies": { "v1-plain": { "type": "template", "template": "Subject: {{subject}}\n\n{{body_text}}" } } }
}
```

Google OAuth2 credentials require a GCP project with Gmail API enabled and an OAuth2 desktop app credential.
