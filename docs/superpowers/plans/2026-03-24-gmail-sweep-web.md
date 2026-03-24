# gmail-sweep Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React + Vite web client with full parity to the terminal client — split-pane inbox, preview with AI summary, HTML email rendering in sandboxed iframe, and same key bindings.

**Architecture:** Thin HTTP consumer. All state managed in `App.tsx` with `useState`. Components are pure presentational. Key bindings via a custom hook that attaches to `document.keydown`. HTML emails render in a sandboxed `<iframe>` to prevent script execution.

**Tech Stack:** TypeScript, React 18, Vite 5, vitest + jsdom, @gmail-sweep/shared

**Prerequisite:** Backend must be running (`npm run dev:backend` from monorepo root). Plan 1 (backend) must be complete.

---

## File Map

```
packages/web/
  package.json              ← deps: react, react-dom, vite, vitest
  tsconfig.json             ← extends ../../tsconfig.base.json + React JSX settings
  vite.config.ts            ← vite setup with vitest
  index.html                ← SPA entry HTML
  src/
    main.tsx                ← React mount point
    api.ts                  ← HTTP client (same interface as terminal/src/api.ts)
    api.test.ts             ← fetch mock tests
    App.tsx                 ← root component: state + layout + view routing
    components/
      EmailList.tsx         ← sidebar: scrollable email list with selection
      EmailPreview.tsx      ← right pane: header + body toggle (summary/text/html)
      SearchBar.tsx         ← search overlay: input + results
    hooks/
      useKeyBindings.ts     ← keyboard shortcut hook
```

---

## Task 1: Package Skeleton

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`

- [ ] **Step 1: Create packages/web/package.json**

```json
{
  "name": "@gmail-sweep/web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@gmail-sweep/shared": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
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

- [ ] **Step 2: Create packages/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create packages/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3141',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Create packages/web/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>gmail-sweep</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body, #root { height: 100%; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install dependencies from monorepo root**

```bash
npm install
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/web/
git commit -m "feat: web package skeleton"
```

---

## Task 2: API Client

**Files:**
- Create: `packages/web/src/api.ts`
- Create: `packages/web/src/api.test.ts`

Identical interface to the terminal client. Uses browser `fetch`. Requests to `/api/*` are proxied by Vite dev server to `http://localhost:3141/*`.

- [ ] **Step 1: Write failing tests**

Create `packages/web/src/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createApiClient } from './api.js';
import type { Email, SyncResult } from '@gmail-sweep/shared';

const api = createApiClient('/api');

function mockOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}
function mockErr(status: number) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: 'fail' }) });
}

describe('api client', () => {
  beforeEach(() => mockFetch.mockReset());

  it('listEmails calls GET /api/emails', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({});
    expect(mockFetch).toHaveBeenCalledWith('/api/emails', expect.any(Object));
  });

  it('listEmails passes query params', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [] }));
    await api.listEmails({ sender: 'alice@example.com', limit: 50 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sender=alice%40example.com');
    expect(url).toContain('limit=50');
  });

  it('getEmail calls GET /api/emails/:id', async () => {
    const email = { id: 'msg1' } as Email;
    mockFetch.mockReturnValue(mockOk(email));
    const result = await api.getEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith('/api/emails/msg1', expect.any(Object));
    expect(result.id).toBe('msg1');
  });

  it('getSummary calls GET /api/emails/:id/summary', async () => {
    mockFetch.mockReturnValue(mockOk({ description: 'Test', actionItems: [], keyPoints: [] }));
    await api.getSummary('msg1');
    expect(mockFetch).toHaveBeenCalledWith('/api/emails/msg1/summary', expect.any(Object));
  });

  it('archiveEmail calls POST /api/emails/:id/archive', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.archiveEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/emails/msg1/archive',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('deleteEmail calls POST /api/emails/:id/delete', async () => {
    mockFetch.mockReturnValue(mockOk({}));
    await api.deleteEmail('msg1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/emails/msg1/delete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sync calls POST /api/sync', async () => {
    const result: SyncResult = { fetched: 10, newEmails: 5, gapsFilled: 0, olderFetched: 0, remainingGaps: [] };
    mockFetch.mockReturnValue(mockOk(result));
    const r = await api.sync(500);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sync',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ batchSize: 500 }) }),
    );
    expect(r.fetched).toBe(10);
  });

  it('search calls POST /api/search', async () => {
    mockFetch.mockReturnValue(mockOk({ emails: [], scores: [] }));
    await api.search('emails about deadlines');
    expect(mockFetch).toHaveBeenCalledWith('/api/search', expect.objectContaining({ method: 'POST' }));
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(mockErr(404));
    await expect(api.getEmail('bad')).rejects.toThrow('HTTP 404');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/web && npx vitest run src/api.test.ts
```

Expected: FAIL — `createApiClient` not found

- [ ] **Step 3: Implement packages/web/src/api.ts**

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
cd packages/web && npx vitest run src/api.test.ts
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api.ts packages/web/src/api.test.ts
git commit -m "feat: web API client"
```

---

## Task 3: useKeyBindings Hook

**Files:**
- Create: `packages/web/src/hooks/useKeyBindings.ts`
- Create: `packages/web/src/hooks/useKeyBindings.test.ts`

Registers/unregisters `keydown` listener on `document`. Maps key combos to action callbacks. Returns `true` from handler to stop propagation.

- [ ] **Step 1: Write failing tests**

Create `packages/web/src/hooks/useKeyBindings.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyBindings } from './useKeyBindings.js';

// renderHook from testing-library — install @testing-library/react if needed
// npm install -D @testing-library/react@14

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useKeyBindings', () => {
  it('calls handler for registered key', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    fireKey('j');
    expect(onJ).toHaveBeenCalledTimes(1);
  });

  it('does not call handler for unregistered key', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    fireKey('k');
    expect(onJ).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', () => {
    const onJ = vi.fn();
    const { unmount } = renderHook(() => useKeyBindings({ j: onJ }));
    unmount();
    fireKey('j');
    expect(onJ).not.toHaveBeenCalled();
  });

  it('ignores keys when typing in input elements', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(onJ).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
```

- [ ] **Step 2: Install testing-library**

```bash
cd packages/web && npm install -D @testing-library/react@14
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/web && npx vitest run src/hooks/useKeyBindings.test.ts
```

Expected: FAIL — `useKeyBindings` not found

- [ ] **Step 4: Implement packages/web/src/hooks/useKeyBindings.ts**

```typescript
import { useEffect } from 'react';

type KeyMap = Record<string, () => void>;

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useKeyBindings(bindings: KeyMap): void {
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && INPUT_TAGS.has(target.tagName)) return;

      const action = bindings[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [bindings]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/web && npx vitest run src/hooks/useKeyBindings.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/useKeyBindings.ts packages/web/src/hooks/useKeyBindings.test.ts
git commit -m "feat: useKeyBindings hook"
```

---

## Task 4: EmailList Component

**Files:**
- Create: `packages/web/src/components/EmailList.tsx`

Sidebar email list. Renders each email as a row with date, sender, subject. Selected row is highlighted. Scrolls selected row into view.

- [ ] **Step 1: Create packages/web/src/components/EmailList.tsx**

```tsx
import { useEffect, useRef } from 'react';
import type { Email } from '@gmail-sweep/shared';

interface Props {
  emails: Email[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function EmailList({ emails, selectedIndex, onSelect }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (emails.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>No emails — press R to sync</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {emails.map((email, i) => (
        <div
          key={email.id}
          ref={i === selectedIndex ? selectedRef : null}
          style={{ ...styles.row, ...(i === selectedIndex ? styles.selected : {}) }}
          onClick={() => onSelect(i)}
        >
          <span style={styles.date}>{email.date.slice(0, 10)}</span>
          <span style={styles.from}>{truncate(email.from, 22)}</span>
          <span style={styles.subject}>{email.subject}</span>
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    overflowY: 'auto',
    height: '100%',
    borderRight: '1px solid #333',
    background: '#1a1a1a',
  },
  empty: {
    padding: '16px',
    color: '#888',
    fontSize: '13px',
  },
  row: {
    display: 'flex',
    gap: '12px',
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #2a2a2a',
    fontSize: '13px',
    color: '#ccc',
    alignItems: 'baseline',
  },
  selected: {
    background: '#1a5276',
    color: '#fff',
  },
  date: {
    flexShrink: 0,
    color: '#888',
    fontSize: '11px',
    width: '80px',
  },
  from: {
    flexShrink: 0,
    width: '160px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subject: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/EmailList.tsx
git commit -m "feat: EmailList sidebar component"
```

---

## Task 5: EmailPreview Component

**Files:**
- Create: `packages/web/src/components/EmailPreview.tsx`

Right pane. Renders email header (subject, from, date, labels) and body. Body toggles between:
- `summary` — AI summary (description, action items, key points)
- `text` — plain text (`bodyText`)
- `html` — rendered HTML in sandboxed `<iframe>`

Web-specific addition: `html` mode renders `bodyHtml` natively. Falls back to `text` if no HTML available.

- [ ] **Step 1: Create packages/web/src/components/EmailPreview.tsx**

```tsx
import type { Email } from '@gmail-sweep/shared';

export type PreviewMode = 'summary' | 'text' | 'html';

interface Props {
  email: Email | null;
  mode: PreviewMode;
  onToggleMode: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function EmailPreview({ email, mode, onToggleMode, onArchive, onDelete }: Props) {
  if (!email) {
    return <div style={styles.empty}>Select an email to preview</div>;
  }

  const modeLabel = mode === 'summary' ? 'Summary' : mode === 'text' ? 'Text' : 'HTML';

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerMeta}>
          <div style={styles.subject}>{email.subject}</div>
          <div style={styles.meta}>
            <span>{email.from}</span>
            <span style={styles.dot}>·</span>
            <span>{email.date.slice(0, 16).replace('T', ' ')}</span>
            <span style={styles.dot}>·</span>
            <span style={styles.labels}>{email.labels.join(', ')}</span>
          </div>
        </div>
        <div style={styles.actions}>
          <button style={styles.btn} onClick={onToggleMode}>[Tab] {modeLabel}</button>
          <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={onArchive}>[a] Archive</button>
          <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={onDelete}>[d] Delete</button>
        </div>
      </div>

      <div style={styles.body}>
        {mode === 'summary' && renderSummary(email)}
        {mode === 'text' && <pre style={styles.plainText}>{email.bodyText}</pre>}
        {mode === 'html' && renderHtml(email)}
      </div>
    </div>
  );
}

function renderSummary(email: Email) {
  if (!email.summary) {
    return <div style={{ color: '#888', padding: '16px' }}>Generating summary…</div>;
  }
  const s = email.summary;
  return (
    <div style={{ padding: '16px', lineHeight: 1.6 }}>
      <p style={{ marginBottom: '16px' }}>{s.description}</p>
      {s.actionItems.length > 0 && (
        <>
          <h4 style={styles.sectionHeader}>ACTION ITEMS</h4>
          <ul style={styles.list}>
            {s.actionItems.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </>
      )}
      {s.keyPoints.length > 0 && (
        <>
          <h4 style={styles.sectionHeader}>KEY POINTS</h4>
          <ul style={styles.list}>
            {s.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

function renderHtml(email: Email) {
  if (!email.bodyHtml) {
    return <pre style={styles.plainText}>{email.bodyText}</pre>;
  }
  return (
    <iframe
      style={styles.iframe}
      sandbox="allow-same-origin"
      srcDoc={email.bodyHtml}
      title="Email content"
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#111',
    color: '#ccc',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#555',
    fontSize: '14px',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexShrink: 0,
  },
  headerMeta: { flex: 1, minWidth: 0 },
  subject: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#eee',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: { fontSize: '12px', color: '#888', display: 'flex', gap: '8px', flexWrap: 'wrap' },
  dot: { color: '#555' },
  labels: { color: '#5dade2' },
  actions: { display: 'flex', gap: '8px', flexShrink: 0 },
  btn: {
    background: '#2a2a2a',
    border: '1px solid #444',
    color: '#ccc',
    padding: '4px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  btnDanger: { color: '#e74c3c', borderColor: '#5a2020' },
  body: { flex: 1, overflow: 'auto' },
  plainText: {
    padding: '16px',
    fontFamily: 'monospace',
    fontSize: '13px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#ccc',
    margin: 0,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    background: '#fff',
  },
  sectionHeader: {
    fontSize: '11px',
    letterSpacing: '0.08em',
    color: '#888',
    marginBottom: '8px',
    marginTop: '16px',
  },
  list: {
    paddingLeft: '20px',
    lineHeight: 1.6,
    fontSize: '14px',
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/EmailPreview.tsx
git commit -m "feat: EmailPreview component with summary/text/html toggle"
```

---

## Task 6: SearchBar Component

**Files:**
- Create: `packages/web/src/components/SearchBar.tsx`

Search overlay. Input at top, results list below. Esc cancels and returns to inbox.

- [ ] **Step 1: Create packages/web/src/components/SearchBar.tsx**

```tsx
import { useRef, useEffect } from 'react';
import type { Email } from '@gmail-sweep/shared';

interface Props {
  results: Email[];
  scores: number[];
  loading: boolean;
  onSearch: (query: string) => void;
  onClose: () => void;
  onSelectResult: (email: Email) => void;
}

export function SearchBar({ results, scores, loading, onSearch, onClose, onSelectResult }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter') {
      const q = inputRef.current?.value.trim();
      if (q) onSearch(q);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.inputRow}>
          <input
            ref={inputRef}
            style={styles.input}
            placeholder='Natural language search, e.g. "emails from Sarah about the deadline"'
            onKeyDown={handleKeyDown}
          />
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.results}>
          {loading && <div style={styles.hint}>Searching…</div>}
          {!loading && results.length === 0 && (
            <div style={styles.hint}>Type a query and press Enter</div>
          )}
          {!loading && results.map((email, i) => (
            <div key={email.id} style={styles.resultRow} onClick={() => onSelectResult(email)}>
              <span style={styles.resultDate}>{email.date.slice(0, 10)}</span>
              <span style={styles.resultFrom}>{truncate(email.from, 25)}</span>
              <span style={styles.resultSubject}>{email.subject}</span>
              {scores[i] != null && (
                <span style={styles.resultScore}>{Math.round(scores[i] * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '80px',
    zIndex: 100,
  },
  panel: {
    background: '#1a1a1a',
    border: '1px solid #444',
    borderRadius: '8px',
    width: '700px',
    maxWidth: '90vw',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  inputRow: {
    display: 'flex',
    borderBottom: '1px solid #333',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#eee',
    fontSize: '16px',
    padding: '16px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '16px',
    padding: '16px',
    cursor: 'pointer',
  },
  results: {
    overflowY: 'auto',
    flex: 1,
  },
  hint: {
    padding: '16px',
    color: '#666',
    fontSize: '13px',
  },
  resultRow: {
    display: 'flex',
    gap: '12px',
    padding: '10px 16px',
    cursor: 'pointer',
    borderBottom: '1px solid #2a2a2a',
    fontSize: '13px',
    color: '#ccc',
    alignItems: 'baseline',
  },
  resultDate: { flexShrink: 0, color: '#888', fontSize: '11px', width: '80px' },
  resultFrom: { flexShrink: 0, width: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resultSubject: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  resultScore: { flexShrink: 0, color: '#5dade2', fontSize: '11px', width: '36px', textAlign: 'right' },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/SearchBar.tsx
git commit -m "feat: SearchBar overlay component"
```

---

## Task 7: App Root + Entry Point

**Files:**
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/main.tsx`

App.tsx owns all state and wires components together. `useKeyBindings` applies the same j/k/Tab/a/d/r/q bindings from the spec.

- [ ] **Step 1: Create packages/web/src/App.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react';
import type { Email } from '@gmail-sweep/shared';
import { createApiClient } from './api.js';
import type { ApiClient } from './api.js';
import { EmailList } from './components/EmailList.js';
import { EmailPreview } from './components/EmailPreview.js';
import type { PreviewMode } from './components/EmailPreview.js';
import { SearchBar } from './components/SearchBar.js';
import { useKeyBindings } from './hooks/useKeyBindings.js';

const api: ApiClient = createApiClient('/api');

type View = 'inbox' | 'search';

export function App() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openEmail, setOpenEmail] = useState<Email | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('summary');
  const [view, setView] = useState<View>('inbox');
  const [searchResults, setSearchResults] = useState<Email[]>([]);
  const [searchScores, setSearchScores] = useState<number[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // Load emails on mount
  useEffect(() => {
    loadEmails();
  }, []);

  async function loadEmails() {
    setLoading(true);
    setStatus('Loading…');
    try {
      const { emails } = await api.listEmails({ limit: 200 });
      setEmails(emails);
      setSelectedIndex(0);
      setStatus(`${emails.length} emails`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }

  async function handleSync() {
    setStatus('Syncing…');
    try {
      const result = await api.sync();
      setStatus(`Sync done — ${result.newEmails} new`);
      await loadEmails();
    } catch (err) {
      setStatus(`Sync error: ${(err as Error).message}`);
    }
  }

  async function handleSelect(index: number) {
    setSelectedIndex(index);
    const email = emails[index];
    if (!email) return;
    setOpenEmail(email);
    setPreviewMode('summary');

    if (!email.summary) {
      try {
        const summary = await api.getSummary(email.id);
        const updated = { ...email, summary };
        setOpenEmail(updated);
        setEmails(prev => prev.map(e => e.id === email.id ? updated : e));
      } catch {
        // summary failed — user can tab to text
      }
    }
  }

  async function handleArchive() {
    const email = openEmail ?? emails[selectedIndex];
    if (!email) return;
    try {
      await api.archiveEmail(email.id);
      setEmails(prev => prev.filter(e => e.id !== email.id));
      setOpenEmail(null);
      setSelectedIndex(i => Math.max(0, i - 1));
      setStatus('Archived');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  async function handleDelete() {
    const email = openEmail ?? emails[selectedIndex];
    if (!email) return;
    try {
      await api.deleteEmail(email.id);
      setEmails(prev => prev.filter(e => e.id !== email.id));
      setOpenEmail(null);
      setSelectedIndex(i => Math.max(0, i - 1));
      setStatus('Deleted');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  function handleToggleMode() {
    setPreviewMode(m => m === 'summary' ? 'text' : m === 'text' ? 'html' : 'summary');
  }

  async function handleSearch(query: string) {
    setSearchLoading(true);
    try {
      const { emails, scores } = await api.search(query);
      setSearchResults(emails);
      setSearchScores(scores);
      setStatus(`${emails.length} results for "${query}"`);
    } catch (err) {
      setStatus(`Search error: ${(err as Error).message}`);
    }
    setSearchLoading(false);
  }

  function handleSelectSearchResult(email: Email) {
    const idx = emails.findIndex(e => e.id === email.id);
    setView('inbox');
    if (idx >= 0) {
      handleSelect(idx);
    } else {
      setOpenEmail(email);
      setPreviewMode('summary');
    }
  }

  // Key bindings — only active when search overlay is closed.
  // useMemo ensures a stable object reference so useKeyBindings' effect
  // only re-registers when the dependencies actually change.
  const bindings = useMemo(() => view !== 'inbox' ? {} : ({
    j: () => setSelectedIndex(i => Math.min(i + 1, emails.length - 1)),
    k: () => setSelectedIndex(i => Math.max(i - 1, 0)),
    ArrowDown: () => setSelectedIndex(i => Math.min(i + 1, emails.length - 1)),
    ArrowUp: () => setSelectedIndex(i => Math.max(i - 1, 0)),
    Enter: () => handleSelect(selectedIndex),
    Tab: handleToggleMode,
    a: handleArchive,
    d: handleDelete,
    '/': () => setView('search'),
    r: handleSync,
    Escape: () => { setOpenEmail(null); setView('inbox'); },
    q: () => window.close(),
  }), [view, emails, selectedIndex, openEmail]);

  useKeyBindings(bindings);

  const previewEmail = openEmail ?? emails[selectedIndex] ?? null;

  return (
    <div style={styles.root}>
      {/* Status bar */}
      <div style={styles.statusBar}>
        <span style={styles.appName}>gmail-sweep</span>
        <span style={styles.statusText}>{loading ? 'Loading…' : status}</span>
        <span style={styles.hint}>j/k navigate · Enter open · Tab toggle view · a archive · d delete · / search · r sync · q quit</span>
      </div>

      {/* Main content */}
      <div style={styles.main}>
        <div style={styles.sidebar}>
          <EmailList
            emails={emails}
            selectedIndex={selectedIndex}
            onSelect={handleSelect}
          />
        </div>
        <div style={styles.preview}>
          <EmailPreview
            email={previewEmail}
            mode={previewMode}
            onToggleMode={handleToggleMode}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {/* Search overlay */}
      {view === 'search' && (
        <SearchBar
          results={searchResults}
          scores={searchScores}
          loading={searchLoading}
          onSearch={handleSearch}
          onClose={() => setView('inbox')}
          onSelectResult={handleSelectSearchResult}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#111',
    color: '#ccc',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '6px 16px',
    background: '#0d0d0d',
    borderBottom: '1px solid #2a2a2a',
    fontSize: '12px',
    flexShrink: 0,
  },
  appName: { fontWeight: 700, color: '#5dade2', letterSpacing: '0.05em' },
  statusText: { color: '#aaa' },
  hint: { marginLeft: 'auto', color: '#555' },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '380px',
    flexShrink: 0,
    overflow: 'hidden',
  },
  preview: {
    flex: 1,
    overflow: 'hidden',
  },
};
```

- [ ] **Step 2: Create packages/web/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/main.tsx
git commit -m "feat: App root and entry point"
```

---

## Task 8: Full Test Run + Smoke Test

- [ ] **Step 1: Run all tests**

```bash
cd packages/web && npx vitest run
```

Expected: PASS — `api.test.ts` (9 tests) and `useKeyBindings.test.ts` (4 tests)

- [ ] **Step 2: Type check**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Manual smoke test (requires backend running)**

In one terminal:
```bash
npm run dev:backend
```

In another:
```bash
cd packages/web && npm run dev
```

Open `http://localhost:5173` in a browser.

Expected:
- Split-pane layout: email list on left, preview on right
- Emails load from backend
- j/k navigate list, Enter opens email, Tab cycles summary → text → html
- a archives, d deletes, / opens search overlay, r syncs
- HTML emails render in iframe, plain-text emails show in `<pre>`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: web client complete"
```
