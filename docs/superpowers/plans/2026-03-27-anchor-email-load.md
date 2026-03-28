# Anchor Email Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `L` key in the terminal inbox that reloads 200 emails anchored at the newest email without a summary, so the user can see what the summarizer is currently working on.

**Architecture:** Add `anchor_unsummarized?: boolean` to the shared `EmailListParams` type. The backend `GET /emails` route detects this flag, looks up the newest unsummarized email's date via the existing `getNextEmailWithoutSummary()` DB method, and uses that date as a `date_to` filter before calling `listEmails`. The terminal adds `anchor_unsummarized` to the query-string builder in `api.ts` and a new `loadEmailsAnchored()` function bound to the `L` key.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, Vitest, @opentui/core

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types.ts` | Add `anchor_unsummarized?: boolean` to `EmailListParams` |
| Modify | `packages/backend/src/routes/emails.ts` | Handle `anchor_unsummarized` flag in `GET /emails` |
| Modify | `packages/backend/src/routes/emails.test.ts` | Tests for anchor behavior |
| Modify | `packages/terminal/src/api.ts` | Add `anchor_unsummarized` to URLSearchParams builder |
| Modify | `packages/terminal/src/api.test.ts` | Test that flag is passed in query string |
| Modify | `packages/terminal/src/index.ts` | Add `loadEmailsAnchored()` and `L` key binding |

---

## Task 1: Add `anchor_unsummarized` to shared EmailListParams

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the field**

In `packages/shared/src/types.ts`, find the `EmailListParams` interface and add one field:

```typescript
export interface EmailListParams {
  sender?: string;
  date_from?: string;
  date_to?: string;
  subject?: string;
  limit?: number;
  offset?: number;
  anchor_unsummarized?: boolean;   // if true, backend anchors results at newest unsummarized email
}
```

- [ ] **Step 2: Rebuild shared package**

```bash
cd packages/shared && npm run build
```

Expected: exits 0, `dist/` updated.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/dist/
git commit -m "feat(shared): add anchor_unsummarized to EmailListParams"
```

---

## Task 2: Handle `anchor_unsummarized` in the emails route

**Files:**
- Modify: `packages/backend/src/routes/emails.ts`
- Modify: `packages/backend/src/routes/emails.test.ts`

The existing `emails.test.ts` uses `buildServer` (full integration with an in-memory DB). The new anchor tests need a DB with known data, so they use the route plugin directly with a mock `DbHandle` — the same pattern used in `summarizer.test.ts` and `sync.test.ts`.

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/src/routes/emails.test.ts` after the existing `describe` block:

```typescript
import Fastify from 'fastify';
import { emailRoutes } from './emails.js';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';

const baseEmail = {
  id: 'e1', threadId: 't1', subject: 'Hello', from: 'a@a.com',
  date: '2024-06-01T00:00:00.000Z', snippet: '', bodyText: 'body',
  bodyHtml: null, labels: [], summary: null,
  hasEmbedding: false, embeddingStrategy: null,
};

function makeEmailDeps(overrides: {
  listEmails?: DbHandle['listEmails'];
  getNextEmailWithoutSummary?: DbHandle['getNextEmailWithoutSummary'];
}) {
  return {
    db: {
      listEmails: overrides.listEmails ?? vi.fn().mockReturnValue([]),
      getNextEmailWithoutSummary: overrides.getNextEmailWithoutSummary ?? vi.fn().mockReturnValue(null),
    } as unknown as DbHandle,
    gmail: {} as GmailService,
    ai: {} as AiService,
  };
}

describe('GET /emails with anchor_unsummarized', () => {
  it('uses the unsummarized email date as date_to when anchor_unsummarized=true', async () => {
    const listEmails = vi.fn().mockReturnValue([baseEmail]);
    const deps = makeEmailDeps({
      listEmails,
      getNextEmailWithoutSummary: vi.fn().mockReturnValue(baseEmail),
    });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails?anchor_unsummarized=true&limit=200' });

    expect(listEmails).toHaveBeenCalledWith(
      expect.objectContaining({ date_to: baseEmail.date, limit: 200 })
    );
  });

  it('applies no date_to filter when anchor_unsummarized=true but all emails are summarized', async () => {
    const listEmails = vi.fn().mockReturnValue([]);
    const deps = makeEmailDeps({
      listEmails,
      getNextEmailWithoutSummary: vi.fn().mockReturnValue(null),
    });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails?anchor_unsummarized=true&limit=200' });

    expect(listEmails).toHaveBeenCalledWith(
      expect.objectContaining({ date_to: undefined })
    );
  });

  it('ignores anchor_unsummarized when not set', async () => {
    const getNextEmailWithoutSummary = vi.fn();
    const deps = makeEmailDeps({ getNextEmailWithoutSummary });
    const app = Fastify();
    await app.register(emailRoutes, deps);

    await app.inject({ method: 'GET', url: '/emails' });

    expect(getNextEmailWithoutSummary).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/routes/emails.test.ts
```

Expected: 3 new tests fail (route doesn't handle `anchor_unsummarized` yet).

- [ ] **Step 3: Update the emails route**

In `packages/backend/src/routes/emails.ts`, update `GET /emails` handler:

```typescript
app.get('/emails', async (request) => {
  const query = request.query as EmailListParams;

  let date_to = query.date_to;
  if (String(query.anchor_unsummarized) === 'true') {
    const anchor = db.getNextEmailWithoutSummary();
    date_to = anchor?.date ?? undefined;
  }

  const emails = db.listEmails({
    sender: query.sender,
    date_from: query.date_from,
    date_to,
    subject: query.subject,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  });
  return { emails };
});
```

> **Note:** Fastify passes all query params as strings regardless of the TypeScript type. `anchor_unsummarized` arrives as the string `'true'`, not the boolean `true`. `String(query.anchor_unsummarized) === 'true'` handles this correctly.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/routes/emails.test.ts
```

Expected: all tests pass (2 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/emails.ts packages/backend/src/routes/emails.test.ts
git commit -m "feat(backend): anchor GET /emails at newest unsummarized email when requested"
```

---

## Task 3: Pass `anchor_unsummarized` from terminal API client

**Files:**
- Modify: `packages/terminal/src/api.ts`
- Modify: `packages/terminal/src/api.test.ts`

- [ ] **Step 1: Write failing test**

In `packages/terminal/src/api.test.ts`, add inside the existing test suite (follow the same mock pattern already used there):

```typescript
it('listEmails includes anchor_unsummarized=true in query string when set', async () => {
  const emails: Email[] = [];
  global.fetch = vi.fn().mockResolvedValueOnce(mockOk({ emails }));

  await api.listEmails({ anchor_unsummarized: true, limit: 200 });

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('anchor_unsummarized=true'),
    expect.any(Object)
  );
});
```

> **Note:** Check the existing `api.test.ts` to verify the mock setup pattern (`mockOk`, `global.fetch`, etc.) and follow it exactly.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: new test fails because `anchor_unsummarized` is not appended to the query string.

- [ ] **Step 3: Update api.ts**

In `packages/terminal/src/api.ts`, in the `listEmails` method, add one line after the existing param checks:

```typescript
if (params.anchor_unsummarized) qs.set('anchor_unsummarized', 'true');
```

The full updated `listEmails` method:

```typescript
listEmails(params) {
  const qs = new URLSearchParams();
  if (params.sender) qs.set('sender', params.sender);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.subject) qs.set('subject', params.subject);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.anchor_unsummarized) qs.set('anchor_unsummarized', 'true');
  const q = qs.toString();
  return request(`${base}/emails${q ? '?' + q : ''}`, {});
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/terminal/src/api.ts packages/terminal/src/api.test.ts
git commit -m "feat(terminal): pass anchor_unsummarized flag in listEmails query string"
```

---

## Task 4: Add `L` key and `loadEmailsAnchored()` to terminal

**Files:**
- Modify: `packages/terminal/src/index.ts`

No tests for this task — same fire-and-forget async pattern as the existing `loadEmails()` and `triggerSync()`.

- [ ] **Step 1: Add loadEmailsAnchored function**

In `packages/terminal/src/index.ts`, add directly after the existing `loadEmails()` function:

```typescript
async function loadEmailsAnchored(): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, 'Loading from unsummarized…');
  render();
  try {
    const { emails } = await api.listEmails({ anchor_unsummarized: true, limit: 200 });
    state = setEmails(state, emails);
    state = setStatus(state, `${emails.length} emails (anchored at unsummarized)`);
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}
```

- [ ] **Step 2: Add L key binding**

In `packages/terminal/src/index.ts`, in the `case 'inbox':` block of `renderer.addInputHandler`, add after the `r` binding:

```typescript
if (seq === 'l' || seq === 'L') { loadEmailsAnchored(); return true; }
```

The updated inbox key block should look like:

```typescript
case 'inbox':
  if (up) { state = prevEmail(state); render(); return true; }
  if (down) { state = nextEmail(state); render(); return true; }
  if (seq === '\r') { triggerOpenEmail(state.selectedIndex); return true; }
  if (seq === '\t') { state = togglePreview(state); render(); return true; }
  if (seq === 'a') { const e = state.emails[state.selectedIndex]; if (e) triggerArchive(e.id); return true; }
  if (seq === 'd') { const e = state.emails[state.selectedIndex]; if (e) triggerDelete(e.id); return true; }
  if (seq === '/') { state = startSearch(state); searchView.focusInput(); render(); return true; }
  if (seq === 'r') { triggerSync(); return true; }
  if (seq === 'l' || seq === 'L') { loadEmailsAnchored(); return true; }
  if (seq === 'q') { renderer.destroy(); process.exit(0); }
  break;
```

- [ ] **Step 3: Run all terminal tests**

```bash
cd packages/terminal && npx vitest run
```

Expected: all tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add packages/terminal/src/index.ts
git commit -m "feat(terminal): add L key to reload emails anchored at newest unsummarized"
```
