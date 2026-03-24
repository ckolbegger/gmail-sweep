# gmail-sweep Terminal Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenTUI terminal client that consumes the backend REST API, providing a split-pane inbox with email preview, full-screen email view, and natural language search.

**Architecture:** Thin HTTP consumer — all business logic lives in the backend. App state is a plain object with pure transition functions. Views are dumb renderers that receive state and return OpenTUI renderables. Key input is handled globally at the renderer level and dispatched based on active view.

**Tech Stack:** TypeScript, @opentui/core, Node.js built-in fetch, vitest

**Prerequisite:** Backend must be running (`npm run dev:backend` from monorepo root). Plan 1 (backend) must be complete.

---

## File Map

```
packages/terminal/
  package.json                ← deps: @opentui/core, @gmail-sweep/shared
  tsconfig.json               ← extends ../../tsconfig.base.json
  src/
    index.ts                  ← entry: init renderer, load emails, key handler loop
    api.ts                    ← HTTP client wrapper for all backend endpoints
    app.ts                    ← AppState + pure state transition functions
    views/
      inbox.ts                ← split-pane: email list (left) + preview (right)
      email.ts                ← full-screen email view with Tab toggle
      search.ts               ← search input + results list
```

---

## Task 1: Package Skeleton

**Files:**
- Create: `packages/terminal/package.json`
- Create: `packages/terminal/tsconfig.json`

- [ ] **Step 1: Create packages/terminal/package.json**

```json
{
  "name": "@gmail-sweep/terminal",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@gmail-sweep/shared": "*",
    "@opentui/core": "^0.1.90"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create packages/terminal/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies from monorepo root**

```bash
npm install
```

Expected: no errors, `@opentui/core` installed in `packages/terminal/node_modules`

- [ ] **Step 4: Commit**

```bash
git add packages/terminal/package.json packages/terminal/tsconfig.json
git commit -m "feat: terminal package skeleton"
```

---

## Task 2: API Client

**Files:**
- Create: `packages/terminal/src/api.ts`
- Create: `packages/terminal/src/api.test.ts`

Wraps all backend HTTP calls. Uses Node.js built-in `fetch`. Throws on non-2xx responses.

- [ ] **Step 1: Write failing tests**

Create `packages/terminal/src/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createApiClient } from './api.js';
import type { Email, SyncResult } from '@gmail-sweep/shared';

const BASE = 'http://localhost:3141';
const api = createApiClient(BASE);

function mockOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}
function mockErr(status: number) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: 'fail' }) });
}

describe('api client', () => {
  beforeEach(() => mockFetch.mockReset());

  it('listEmails calls GET /emails', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({});
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails`, expect.any(Object));
  });

  it('listEmails passes query params', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({ sender: 'alice@example.com', limit: 50 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sender=alice%40example.com');
    expect(url).toContain('limit=50');
  });

  it('getEmail calls GET /emails/:id', async () => {
    const email = { id: 'msg1' } as Email;
    mockFetch.mockReturnValue(mockOk(email));
    const result = await api.getEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1`, expect.any(Object));
    expect(result.id).toBe('msg1');
  });

  it('getSummary calls GET /emails/:id/summary', async () => {
    mockFetch.mockReturnValue(mockOk({ description: 'Test', actionItems: [], keyPoints: [] }));
    await api.getSummary('msg1');
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/emails/msg1/summary`, expect.any(Object));
  });

  it('archiveEmail calls POST /emails/:id/archive', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.archiveEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/emails/msg1/archive`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('deleteEmail calls POST /emails/:id/delete', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.deleteEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/emails/msg1/delete`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sync calls POST /sync with batchSize', async () => {
    const result: SyncResult = { fetched: 10, newEmails: 5, gapsFilled: 0, olderFetched: 0, remainingGaps: [] };
    mockFetch.mockReturnValue(mockOk(result));
    const r = await api.sync(500);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/sync`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ batchSize: 500 }) }),
    );
    expect(r.fetched).toBe(10);
  });

  it('search calls POST /search', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [], scores: [] }));
    await api.search('emails about deadlines');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/search`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(mockErr(404));
    await expect(api.getEmail('bad')).rejects.toThrow('HTTP 404');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: FAIL — `createApiClient` not found

- [ ] **Step 3: Implement packages/terminal/src/api.ts**

```typescript
import type { Email, EmailSummary, EmailListParams, SyncResult, SearchResult } from '@gmail-sweep/shared';

export interface ApiClient {
  listEmails(params: EmailListParams): Promise<{ emails: Email[] }>;
  getEmail(id: string): Promise<Email>;
  getSummary(id: string): Promise<EmailSummary>;
  archiveEmail(id: string): Promise<void>;
  deleteEmail(id: string): Promise<void>;
  sync(batchSize?: number): Promise<SyncResult>;
  search(query: string, limit?: number): Promise<SearchResult>;
  authStatus(): Promise<{ authenticated: boolean; email?: string }>;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

export function createApiClient(base: string): ApiClient {
  return {
    listEmails(params) {
      const qs = new URLSearchParams();
      if (params.sender) qs.set('sender', params.sender);
      if (params.date_from) qs.set('date_from', params.date_from);
      if (params.date_to) qs.set('date_to', params.date_to);
      if (params.subject) qs.set('subject', params.subject);
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.offset != null) qs.set('offset', String(params.offset));
      const q = qs.toString();
      return request(`${base}/emails${q ? '?' + q : ''}`, {});
    },
    getEmail(id) { return request(`${base}/emails/${id}`, {}); },
    getSummary(id) { return request(`${base}/emails/${id}/summary`, {}); },
    archiveEmail(id) { return request(`${base}/emails/${id}/archive`, { method: 'POST' }); },
    deleteEmail(id) { return request(`${base}/emails/${id}/delete`, { method: 'POST' }); },
    sync(batchSize = 500) {
      return request(`${base}/sync`, {
        method: 'POST',
        body: JSON.stringify({ batchSize }),
      });
    },
    search(query, limit = 20) {
      return request(`${base}/search`, {
        method: 'POST',
        body: JSON.stringify({ query, limit }),
      });
    },
    authStatus() { return request(`${base}/auth/status`, {}); },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/terminal && npx vitest run src/api.test.ts
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/terminal/src/api.ts packages/terminal/src/api.test.ts
git commit -m "feat: terminal API client"
```

---

## Task 3: App State

**Files:**
- Create: `packages/terminal/src/app.ts`
- Create: `packages/terminal/src/app.test.ts`

Pure state with pure transition functions — no side effects, no rendering. Easy to test.

- [ ] **Step 1: Write failing tests**

Create `packages/terminal/src/app.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createAppState, setEmails, nextEmail, prevEmail, selectEmail,
  togglePreview, archiveEmail, deleteEmail, backToInbox, startSearch,
  setSearchResults, setStatus,
} from './app.js';
import type { Email } from '@gmail-sweep/shared';

function makeEmail(id: string): Email {
  return {
    id, threadId: 'thread1', subject: `Subject ${id}`, from: 'a@b.com',
    date: '2026-01-01T00:00:00Z', snippet: '', bodyText: 'body', bodyHtml: null,
    labels: ['INBOX'], summary: null, hasEmbedding: false, embeddingStrategy: null,
  };
}

describe('app state', () => {
  it('starts with empty email list and inbox view', () => {
    const s = createAppState();
    expect(s.emails).toEqual([]);
    expect(s.selectedIndex).toBe(0);
    expect(s.view).toBe('inbox');
    expect(s.openEmail).toBeNull();
  });

  it('setEmails replaces list and resets selection to 0', () => {
    const s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    expect(s.emails).toHaveLength(2);
    expect(s.selectedIndex).toBe(0);
  });

  it('nextEmail increments, capped at last index', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b'), makeEmail('c')]);
    s = nextEmail(s);
    expect(s.selectedIndex).toBe(1);
    s = nextEmail(nextEmail(s)); // 2, then stays at 2
    expect(s.selectedIndex).toBe(2);
  });

  it('prevEmail decrements, capped at 0', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    s = nextEmail(s); // 1
    s = prevEmail(s); // 0
    expect(s.selectedIndex).toBe(0);
    s = prevEmail(s); // still 0
    expect(s.selectedIndex).toBe(0);
  });

  it('selectEmail switches to email view with the right email', () => {
    const emails = [makeEmail('a'), makeEmail('b')];
    let s = setEmails(createAppState(), emails);
    s = nextEmail(s); // select index 1
    s = selectEmail(s, s.selectedIndex);
    expect(s.view).toBe('email');
    expect(s.openEmail?.id).toBe('b');
    expect(s.previewMode).toBe('summary');
  });

  it('togglePreview flips between summary and fulltext', () => {
    let s = createAppState();
    expect(s.previewMode).toBe('summary');
    s = togglePreview(s);
    expect(s.previewMode).toBe('fulltext');
    s = togglePreview(s);
    expect(s.previewMode).toBe('summary');
  });

  it('archiveEmail removes the email and clamps selection', () => {
    const emails = [makeEmail('a'), makeEmail('b'), makeEmail('c')];
    let s = setEmails(createAppState(), emails);
    s = { ...s, selectedIndex: 2 };
    s = archiveEmail(s, 'c');
    expect(s.emails.map(e => e.id)).toEqual(['a', 'b']);
    expect(s.selectedIndex).toBe(1); // clamped
  });

  it('deleteEmail removes the email', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    s = deleteEmail(s, 'a');
    expect(s.emails.map(e => e.id)).toEqual(['b']);
    expect(s.selectedIndex).toBe(0);
  });

  it('backToInbox resets to inbox view', () => {
    let s = selectEmail(setEmails(createAppState(), [makeEmail('a')]), 0);
    s = backToInbox(s);
    expect(s.view).toBe('inbox');
    expect(s.openEmail).toBeNull();
  });

  it('startSearch switches to search view', () => {
    const s = startSearch(createAppState());
    expect(s.view).toBe('search');
    expect(s.searchQuery).toBe('');
  });

  it('setSearchResults stores results and scores', () => {
    const emails = [makeEmail('a')];
    const s = setSearchResults(createAppState(), emails, [0.95]);
    expect(s.searchResults).toHaveLength(1);
    expect(s.searchScores).toEqual([0.95]);
  });

  it('setStatus sets status message', () => {
    const s = setStatus(createAppState(), 'Loading...');
    expect(s.status).toBe('Loading...');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/terminal && npx vitest run src/app.test.ts
```

Expected: FAIL — `createAppState` not found

- [ ] **Step 3: Implement packages/terminal/src/app.ts**

```typescript
import type { Email } from '@gmail-sweep/shared';

export type View = 'inbox' | 'email' | 'search';
export type PreviewMode = 'summary' | 'fulltext';

export interface AppState {
  emails: Email[];
  selectedIndex: number;
  view: View;
  openEmail: Email | null;
  previewMode: PreviewMode;
  searchQuery: string;
  searchResults: Email[];
  searchScores: number[];
  status: string;
  loading: boolean;
}

export function createAppState(): AppState {
  return {
    emails: [],
    selectedIndex: 0,
    view: 'inbox',
    openEmail: null,
    previewMode: 'summary',
    searchQuery: '',
    searchResults: [],
    searchScores: [],
    status: 'Ready',
    loading: false,
  };
}

export function setEmails(s: AppState, emails: Email[]): AppState {
  return { ...s, emails, selectedIndex: 0 };
}

export function nextEmail(s: AppState): AppState {
  if (s.emails.length === 0) return s;
  return { ...s, selectedIndex: Math.min(s.selectedIndex + 1, s.emails.length - 1) };
}

export function prevEmail(s: AppState): AppState {
  return { ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) };
}

export function selectEmail(s: AppState, index: number): AppState {
  return { ...s, view: 'email', openEmail: s.emails[index] ?? null, previewMode: 'summary' };
}

export function togglePreview(s: AppState): AppState {
  return { ...s, previewMode: s.previewMode === 'summary' ? 'fulltext' : 'summary' };
}

export function archiveEmail(s: AppState, id: string): AppState {
  const emails = s.emails.filter(e => e.id !== id);
  return { ...s, emails, selectedIndex: Math.min(s.selectedIndex, Math.max(0, emails.length - 1)) };
}

export function deleteEmail(s: AppState, id: string): AppState {
  const emails = s.emails.filter(e => e.id !== id);
  return { ...s, emails, selectedIndex: Math.min(s.selectedIndex, Math.max(0, emails.length - 1)) };
}

export function backToInbox(s: AppState): AppState {
  return { ...s, view: 'inbox', openEmail: null };
}

export function startSearch(s: AppState): AppState {
  return { ...s, view: 'search', searchQuery: '', searchResults: [] };
}

export function setSearchResults(s: AppState, emails: Email[], scores: number[]): AppState {
  return { ...s, searchResults: emails, searchScores: scores };
}

export function setStatus(s: AppState, status: string): AppState {
  return { ...s, status };
}

export function setLoading(s: AppState, loading: boolean): AppState {
  return { ...s, loading };
}

export function updateOpenEmail(s: AppState, updated: Email): AppState {
  return {
    ...s,
    openEmail: s.openEmail?.id === updated.id ? updated : s.openEmail,
    emails: s.emails.map(e => e.id === updated.id ? updated : e),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/terminal && npx vitest run src/app.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/terminal/src/app.ts packages/terminal/src/app.test.ts
git commit -m "feat: terminal app state with pure transitions"
```

---

## Task 4: Inbox View

**Files:**
- Create: `packages/terminal/src/views/inbox.ts`

Split-pane inbox. Left pane = scrollable email list with selection highlight. Right pane = preview (summary or full text). Both panes receive `AppState` and re-render from scratch on each call (simple, correct for personal-inbox scale).

**OpenTUI API notes:**
- `Box(renderer, opts)` — flex container. Layout props set directly: `box.flexDirection = 'row'`
- `Text(renderer, opts)` — renders text. `text.content = 'new text'` to update
- `ScrollBox(renderer, opts)` — scrollable. `scrollBox.scrollChildIntoView(id)` scrolls a child into view
- `scrollBox.remove(id)` removes a child by id; `scrollBox.getChildren()` returns child array

- [ ] **Step 1: Create packages/terminal/src/views/inbox.ts**

```typescript
import { Box, Text, ScrollBox } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildInboxView(renderer: any) {
  // Outer container: horizontal split
  const root = new Box(renderer, { id: 'inbox-root' });
  root.flexDirection = 'row';
  root.width = '100%';
  root.height = '100%';

  // Left: email list pane
  const listPane = new Box(renderer, {
    id: 'list-pane',
    border: true,
    title: ' Inbox ',
    titleAlignment: 'left',
  });
  listPane.flexGrow = 1;
  listPane.height = '100%';

  const listScroll = new ScrollBox(renderer, { id: 'list-scroll', scrollY: true });
  listScroll.width = '100%';
  listScroll.height = '100%';
  listPane.add(listScroll);

  // Right: preview pane
  const previewPane = new Box(renderer, {
    id: 'preview-pane',
    border: true,
    title: ' Preview  [Tab: toggle summary/full text] ',
    titleAlignment: 'left',
  });
  previewPane.flexGrow = 2;
  previewPane.height = '100%';

  const previewText = new Text(renderer, { id: 'preview-text', content: '' });
  previewText.width = '100%';
  previewText.padding = 1;
  previewPane.add(previewText);

  root.add(listPane);
  root.add(previewPane);

  function render(state: AppState): void {
    renderList(state);
    renderPreview(state);
  }

  function renderList(state: AppState): void {
    // Remove existing items
    for (const child of listScroll.getChildren()) {
      listScroll.remove((child as any).id);
    }

    if (state.emails.length === 0) {
      const empty = new Text(renderer, { id: 'list-empty', content: '  (no emails — press r to sync)' });
      listScroll.add(empty);
      return;
    }

    state.emails.forEach((email, i) => {
      const selected = i === state.selectedIndex;
      const date = email.date.slice(0, 10);
      const from = truncate(email.from, 20);
      const subject = truncate(email.subject, 38);
      const marker = selected ? '▶' : ' ';
      const line = `${marker} ${date}  ${from.padEnd(22)}  ${subject}`;

      const item = new Text(renderer, { id: `list-item-${i}`, content: line });
      item.width = '100%';
      if (selected) {
        (item as any).backgroundColor = '#1a5276';
      }
      listScroll.add(item);
    });

    if (state.emails.length > 0) {
      listScroll.scrollChildIntoView(`list-item-${state.selectedIndex}`);
    }
  }

  function renderPreview(state: AppState): void {
    const email = state.emails[state.selectedIndex];
    if (!email) {
      previewText.content = '';
      return;
    }

    const header = [
      `Subject: ${email.subject}`,
      `From:    ${email.from}`,
      `Date:    ${email.date}`,
      `Labels:  ${email.labels.join(', ')}`,
      '',
    ];

    if (state.previewMode === 'summary' && email.summary) {
      const s = email.summary;
      previewText.content = [
        ...header,
        s.description,
        '',
        'ACTION ITEMS',
        ...s.actionItems.map(a => `  • ${a}`),
        '',
        'KEY POINTS',
        ...s.keyPoints.map(k => `  • ${k}`),
      ].join('\n');
    } else if (state.previewMode === 'summary') {
      previewText.content = [
        ...header,
        '(loading summary — press Tab for full text)',
      ].join('\n');
    } else {
      previewText.content = [...header, email.bodyText].join('\n');
    }
  }

  return { root, render };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 2) + '..' : s;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/terminal/src/views/inbox.ts
git commit -m "feat: inbox split-pane view"
```

---

## Task 5: Email View

**Files:**
- Create: `packages/terminal/src/views/email.ts`

Full-screen email. Scrollable content. Tab toggles summary/full text. Esc/a/d handled by global key handler.

- [ ] **Step 1: Create packages/terminal/src/views/email.ts**

```typescript
import { Box, Text, ScrollBox } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildEmailView(renderer: any) {
  const root = new Box(renderer, {
    id: 'email-root',
    border: true,
    title: ' Email  [Tab: toggle  Esc: back  a: archive  d: delete] ',
    titleAlignment: 'left',
  });
  root.width = '100%';
  root.height = '100%';

  const scroll = new ScrollBox(renderer, { id: 'email-scroll', scrollY: true });
  scroll.width = '100%';
  scroll.height = '100%';

  const content = new Text(renderer, { id: 'email-content', content: '' });
  content.width = '100%';
  content.padding = 1;
  scroll.add(content);
  root.add(scroll);

  function render(state: AppState): void {
    const email = state.openEmail;
    if (!email) return;

    scroll.scrollTo(0);

    const header = [
      `Subject: ${email.subject}`,
      `From:    ${email.from}`,
      `Date:    ${email.date}`,
      `Labels:  ${email.labels.join(', ')}`,
      '',
    ];

    if (state.previewMode === 'summary' && email.summary) {
      const s = email.summary;
      content.content = [
        ...header,
        '─── AI SUMMARY ───────────────────────────────',
        '',
        s.description,
        '',
        'ACTION ITEMS',
        ...s.actionItems.map(a => `  • ${a}`),
        '',
        'KEY POINTS',
        ...s.keyPoints.map(k => `  • ${k}`),
      ].join('\n');
    } else if (state.previewMode === 'summary') {
      content.content = [...header, '(generating summary…)'].join('\n');
    } else {
      content.content = [...header, email.bodyText].join('\n');
    }
  }

  return { root, render };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/terminal/src/views/email.ts
git commit -m "feat: full-screen email view"
```

---

## Task 6: Search View

**Files:**
- Create: `packages/terminal/src/views/search.ts`

Text input at top. Results list below. `onSearch` callback fires when user presses Enter.

**OpenTUI Input note:** `Input` accepts text input. Listen for Enter via `onKeyDown` callback on the renderable. Read the current value with the `value` property (verify the exact property name in `@opentui/core` Input source if type errors appear; cast to `any` as fallback).

- [ ] **Step 1: Create packages/terminal/src/views/search.ts**

```typescript
import { Box, Text, ScrollBox, Input } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildSearchView(renderer: any, onSearch: (query: string) => void) {
  const root = new Box(renderer, { id: 'search-root' });
  root.flexDirection = 'column';
  root.width = '100%';
  root.height = '100%';

  // Input row
  const inputBox = new Box(renderer, {
    id: 'search-input-box',
    border: true,
    title: ' Search  [Enter: search  Esc: cancel] ',
    titleAlignment: 'left',
  });
  inputBox.width = '100%';
  inputBox.height = 5;

  const input = new Input(renderer, {
    id: 'search-input',
    placeholder: 'Natural language query, e.g. "emails from Sarah about the deadline"',
  } as any);
  input.width = '100%';
  inputBox.add(input);

  // Handle Enter on input
  (input as any).onKeyDown = (seq: string) => {
    if (seq === '\r' || seq === '\n') {
      const q: string = (input as any).value ?? '';
      if (q.trim()) onSearch(q.trim());
    }
  };

  // Results list
  const resultsBox = new Box(renderer, {
    id: 'search-results-box',
    border: true,
    title: ' Results ',
    titleAlignment: 'left',
  });
  resultsBox.width = '100%';
  resultsBox.flexGrow = 1;

  const resultsList = new ScrollBox(renderer, { id: 'results-scroll', scrollY: true });
  resultsList.width = '100%';
  resultsList.height = '100%';
  resultsBox.add(resultsList);

  root.add(inputBox);
  root.add(resultsBox);

  function focusInput(): void {
    (input as any).focus?.();
  }

  function render(state: AppState): void {
    for (const child of resultsList.getChildren()) {
      resultsList.remove((child as any).id);
    }

    if (state.loading) {
      resultsList.add(new Text(renderer, { id: 'r-loading', content: '  Searching…' }));
      return;
    }

    if (state.searchResults.length === 0) {
      resultsList.add(new Text(renderer, {
        id: 'r-empty',
        content: '  No results. Type a query above and press Enter.',
      }));
      return;
    }

    state.searchResults.forEach((email, i) => {
      const date = email.date.slice(0, 10);
      const from = truncate(email.from, 20);
      const subject = truncate(email.subject, 46);
      const score = state.searchScores[i];
      const scoreStr = score != null ? `  ${Math.round(score * 100)}%` : '';
      const line = `  ${date}  ${from.padEnd(22)}  ${subject}${scoreStr}`;
      const item = new Text(renderer, { id: `result-${i}`, content: line });
      item.width = '100%';
      resultsList.add(item);
    });
  }

  return { root, render, focusInput };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 2) + '..' : s;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/terminal/src/views/search.ts
git commit -m "feat: search view with input and results"
```

---

## Task 7: Entry Point + Key Bindings

**Files:**
- Create: `packages/terminal/src/index.ts`

Wires everything together: init renderer, load initial emails, handle key sequences, switch views.

**Key sequences:**
- `\x1b[A` = up arrow, `\x1b[B` = down arrow
- `\r` = Enter, `\t` = Tab, `\x1b` = Escape (bare)
- Single chars: `j`, `k`, `a`, `d`, `/`, `r`, `q`

**View switching strategy:** Only one view root is added to `renderer.root` at a time. When switching views, remove the current root and add the new one.

- [ ] **Step 1: Create packages/terminal/src/index.ts**

```typescript
import { createCliRenderer } from '@opentui/core';
import { createApiClient } from './api.js';
import {
  createAppState, setEmails, nextEmail, prevEmail, selectEmail, togglePreview,
  archiveEmail, deleteEmail, backToInbox, startSearch, setSearchResults,
  setStatus, setLoading, updateOpenEmail,
} from './app.js';
import type { AppState } from './app.js';
import { buildInboxView } from './views/inbox.js';
import { buildEmailView } from './views/email.js';
import { buildSearchView } from './views/search.js';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:3141';
const api = createApiClient(BACKEND_URL);

const renderer = await createCliRenderer({ exitOnCtrlC: false });
renderer.setTerminalTitle('gmail-sweep');
renderer.root.flexDirection = 'column';
renderer.root.width = '100%';
renderer.root.height = '100%';

let state: AppState = createAppState();

// Build views (not yet added to root)
const inboxView = buildInboxView(renderer);
const emailView = buildEmailView(renderer);
const searchView = buildSearchView(renderer, triggerSearch);

// View switching
let activeRoot: any = null;
function showView(viewRoot: any): void {
  if (activeRoot) renderer.root.remove(activeRoot.id);
  activeRoot = viewRoot;
  renderer.root.add(activeRoot);
}

function render(): void {
  if (state.view === 'inbox') {
    showView(inboxView.root);
    inboxView.render(state);
  } else if (state.view === 'email') {
    showView(emailView.root);
    emailView.render(state);
  } else {
    showView(searchView.root);
    searchView.render(state);
  }
  renderer.requestRender();
}

// Async actions
async function loadEmails(): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, 'Loading…');
  render();
  try {
    const { emails } = await api.listEmails({ limit: 200 });
    state = setEmails(state, emails);
    state = setStatus(state, `${emails.length} emails`);
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}

async function triggerSync(): Promise<void> {
  state = setStatus(state, 'Syncing…');
  render();
  try {
    const result = await api.sync();
    state = setStatus(state, `Sync done — ${result.newEmails} new`);
    await loadEmails();
  } catch (err) {
    state = setStatus(state, `Sync error: ${(err as Error).message}`);
    render();
  }
}

async function triggerArchive(id: string): Promise<void> {
  try {
    await api.archiveEmail(id);
    state = archiveEmail(state, id);
    if (state.view === 'email') state = backToInbox(state);
    state = setStatus(state, 'Archived');
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  render();
}

async function triggerDelete(id: string): Promise<void> {
  try {
    await api.deleteEmail(id);
    state = deleteEmail(state, id);
    if (state.view === 'email') state = backToInbox(state);
    state = setStatus(state, 'Deleted');
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  render();
}

async function triggerSearch(query: string): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, `Searching: "${query}"…`);
  render();
  try {
    const { emails, scores } = await api.search(query);
    state = setSearchResults(state, emails, scores);
    state = setStatus(state, `${emails.length} results for "${query}"`);
  } catch (err) {
    state = setStatus(state, `Search error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}

async function triggerOpenEmail(index: number): Promise<void> {
  state = selectEmail(state, index);
  render();
  const email = state.openEmail;
  if (!email || email.summary) return;
  state = setStatus(state, 'Generating summary…');
  render();
  try {
    const summary = await api.getSummary(email.id);
    state = updateOpenEmail(state, { ...email, summary });
    state = setStatus(state, '');
  } catch {
    state = setStatus(state, 'Summary failed — Tab for full text');
  }
  render();
}

// Global key handler
renderer.addInputHandler((seq: string): boolean => {
  const up = seq === '\x1b[A' || seq === 'k';
  const down = seq === '\x1b[B' || seq === 'j';

  switch (state.view) {
    case 'inbox':
      if (up) { state = prevEmail(state); render(); return true; }
      if (down) { state = nextEmail(state); render(); return true; }
      if (seq === '\r') { triggerOpenEmail(state.selectedIndex); return true; }
      if (seq === '\t') { state = togglePreview(state); render(); return true; }
      if (seq === 'a') { const e = state.emails[state.selectedIndex]; if (e) triggerArchive(e.id); return true; }
      if (seq === 'd') { const e = state.emails[state.selectedIndex]; if (e) triggerDelete(e.id); return true; }
      if (seq === '/') { state = startSearch(state); searchView.focusInput(); render(); return true; }
      if (seq === 'r') { triggerSync(); return true; }
      if (seq === 'q') { renderer.destroy(); process.exit(0); }
      break;

    case 'email':
      if (seq === '\x1b') { state = backToInbox(state); render(); return true; }
      if (seq === '\t') { state = togglePreview(state); render(); return true; }
      if (seq === 'a' && state.openEmail) { triggerArchive(state.openEmail.id); return true; }
      if (seq === 'd' && state.openEmail) { triggerDelete(state.openEmail.id); return true; }
      if (seq === 'q') { renderer.destroy(); process.exit(0); }
      break;

    case 'search':
      if (seq === '\x1b') { state = backToInbox(state); render(); return true; }
      // Other keys (character input) flow to the focused Input component
      break;
  }
  return false;
});

// Start
await loadEmails();
render();
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/terminal && npx tsc --noEmit
```

Expected: no errors (or only minor type errors in the `as any` OpenTUI casts — acceptable)

- [ ] **Step 3: Commit**

```bash
git add packages/terminal/src/index.ts
git commit -m "feat: terminal entry point with key bindings"
```

---

## Task 8: Full Test Run + Smoke Test

- [ ] **Step 1: Run all unit tests**

```bash
cd packages/terminal && npx vitest run
```

Expected: PASS — at minimum `api.test.ts` (9 tests) and `app.test.ts` (12 tests)

- [ ] **Step 2: Manual smoke test (requires backend running)**

In one terminal:
```bash
npm run dev:backend
```

In another:
```bash
cd packages/terminal && node --experimental-strip-types src/index.ts
```

Expected: Split-pane inbox renders. Email list loads. Key bindings work: j/k navigate, Enter opens email, Tab toggles preview, a archives, d deletes, / opens search, r syncs, q quits.

- [ ] **Step 3: Commit**

```bash
git add packages/terminal/
git commit -m "feat: terminal client complete"
```
