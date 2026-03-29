# Codex Review: Gmail Sweep TUI Spec and Plan

## Findings

### 1. Vector search architecture is not concrete enough to implement safely

The spec stores embeddings directly on `emails.embedding` as a `BLOB` while also assuming `sqlite-vec` ranking and filtered semantic search. The plan only adds a test that the embedding is stored "as BLOB in sqlite-vec format" and never defines the actual `sqlite-vec` table or index lifecycle.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:42`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:197`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:225`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:978`

Risk:
- There is no clear path from this schema to efficient vector queries.
- Semantic search may either not work or devolve to full scans with ad hoc ranking.

### 2. The gap-sync model relies on cursors the API contract does not provide

The Gmail adapter exposes `maxResults` and `pageToken`, but the sync design depends on "fetch newest since last high watermark" and "fill gap from its `after_ts` downward." Those are not equivalent contracts. Timestamp boundaries are not stable mailbox cursors.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:77`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:150`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:153`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:481`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:693`

Risk:
- Same-timestamp messages, mailbox mutation, and reordering can create skips or duplicates.
- The design needs a history-based or explicitly query/cursor-based sync model before implementation.

### 3. Failed mutation handling is contradictory

The spec says network failures should queue operations for retry. The plan removes archived and deleted emails from the local database immediately and never defines an outbox, pending-operation state, or replay flow.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:368`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:602`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:609`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:1079`

Risk:
- If Gmail mutation fails after local removal, local and remote state diverge.
- This is especially problematic for archive/delete because they are destructive from the local UI perspective.

### 4. The auth contract diverges between the spec and the plan

The spec says the backend opens the browser automatically and receives `GET /oauth/callback`. The plan introduces `GET /auth/url`, `GET /auth/callback`, and `GET /auth/status`, and tells the user to visit `/auth/url` manually. The spec's REST endpoint table also omits auth routes entirely.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:56`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:58`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:92`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:346`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:351`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:392`

Risk:
- These are materially different route and UX contracts.
- Implementation can drift depending on which document the implementer follows.

### 5. The plan drops parts of the published API contract but still claims coverage

The spec says `GET /emails` is filterable by label and read status, and `GET /sync/status` includes watermark positions and worker queue depth. The plan only tests unread filtering on `/emails` and basic counts on `/sync/status`.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:96`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:103`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:506`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:533`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:1112`

Risk:
- The "Spec Coverage Check" overstates completeness.
- Important API details can quietly disappear during implementation.

### 6. Search/filter semantics are internally inconsistent

The spec stores labels as JSON text but defines `label:` using `LIKE '%Finance%'`. The plan later expects proper JSON-based filtering. Those imply different storage and query behavior.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:179`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:214`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:959`

Risk:
- `LIKE` against JSON text is imprecise and can produce false positives.
- This will become harder to change after data is already stored.

### 7. There is no migration/versioning story despite repeated schema changes

The plan starts with a deliberately incomplete schema, then repeatedly instructs the implementer to wipe the database as later slices add gaps, AI fields, and embeddings.

References:
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:184`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:415`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:669`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:797`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:924`

Risk:
- For a persistent local mail client, schema migration is part of the architecture, not a testing footnote.
- Repeated wipes hide upgrade and compatibility problems until late.

### 8. The TUI interaction model is still ambiguous

The spec says `Tab` toggles summary/full, but also says `Enter` opens full email in the detail panel. The plan never assigns behavior to `Enter`. Separately, the status bar is expected to host key hints, auth state, search input, sync feedback, errors, and queue depth with no priority model.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:291`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:301`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:313`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:392`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:774`
- `docs/superpowers/plans/2026-03-29-gmail-sweep-tui.md:1079`

Risk:
- Implementers will make incompatible assumptions about navigation and status priority.
- This is likely to produce brittle tests and later UI rewrites.

### 9. The sample tmux harness contains a broken command

The sample `tmux new-session` string is malformed as written.

Reference:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:409`

Risk:
- A reader copying the example will fail immediately.
- It also reduces trust in the testing section.

## Additional Risky Assumptions

### Provider example config is questionable

The config assumes an "OpenAI-compatible" endpoint but uses `claude-sonnet-4-6` as the example summary model. That may be valid behind a proxy, but it is not explained and is a risky default assumption.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:329`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:332`

### OAuth scopes exceed current MVP needs

The spec requests `gmail.compose` even though reply/forward is explicitly deferred.

References:
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:69`
- `docs/superpowers/specs/2026-03-28-gmail-sweep-tui-design.md:7`

## Bottom Line

The largest issues are not minor omissions. The current spec/plan pair still lacks stable contracts for:

- sync cursoring and gap correctness
- vector storage and search execution
- failed mutation handling and retry semantics

Those should be resolved before implementation starts.
