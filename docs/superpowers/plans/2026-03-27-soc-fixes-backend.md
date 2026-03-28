# SoC Fixes: Backend Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 8 SoC violations found in the backend package review by moving business logic out of route handlers and into the appropriate service layer.

**Architecture:** Six independent refactors applied bottom-up: pure utility moves first, then data-layer additions, then new service helpers, and finally route simplification. Each task is self-contained and leaves all tests green.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vitest

---

## File Map

| File | Change | Reason |
|------|--------|--------|
| `packages/backend/src/services/content.ts` | Add `cosineSimilarity` export | Move math utility from search.ts |
| `packages/backend/src/services/content.test.ts` | Add `cosineSimilarity` tests | TDD for new export |
| `packages/backend/src/services/search.ts` | Import `cosineSimilarity` from content.ts; remove local definition | Consume moved utility |
| `packages/backend/src/services/ai.ts` | Hoist client instantiation to factory scope | Avoid re-creating clients on every call |
| `packages/backend/src/services/db.ts` | Add `archiveEmail` and `trashEmail` to `DbHandle` interface and implementation | Domain label semantics belong in data layer |
| `packages/backend/src/services/db.test.ts` | Add tests for `archiveEmail` and `trashEmail` | TDD for new db methods |
| `packages/backend/src/services/email-ops.ts` | Create — exports `getOrCreateSummary` | Cross-service orchestration helper |
| `packages/backend/src/services/email-ops.test.ts` | Create — tests for `getOrCreateSummary` | TDD for new service |
| `packages/backend/src/services/sync.ts` | Add `runSyncWithEmbeddings`; move `EMBEDDING_BATCH_SIZE` constant here | Extract orchestration from route |
| `packages/backend/src/services/sync.test.ts` | Add test for `runSyncWithEmbeddings` | TDD for new export |
| `packages/backend/src/routes/emails.ts` | Use `archiveEmail`, `trashEmail`, `getOrCreateSummary`; remove inline label logic; drop magic `50` | Thin route layer |
| `packages/backend/src/routes/sync.ts` | Use `runSyncWithEmbeddings`; remove `EMBEDDING_BATCH_SIZE` | Thin route layer |

---

## Task 1: Move `cosineSimilarity` to `services/content.ts`

**Files:**
- Modify: `packages/backend/src/services/content.ts`
- Modify: `packages/backend/src/services/content.test.ts`
- Modify: `packages/backend/src/services/search.ts`

- [ ] **Step 1: Write failing test in `content.test.ts`**

Add inside the existing `describe('content extraction', ...)` block:

```typescript
describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
```

Add the import at the top of `content.test.ts`:

```typescript
import { htmlToText, buildEmbeddingText, cosineSimilarity } from './content.js';
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/services/content.test.ts
```

Expected: FAIL — `cosineSimilarity` is not exported from `content.ts`

- [ ] **Step 3: Add `cosineSimilarity` to `services/content.ts`**

Append to the bottom of the file:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    normA += a[i]! ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/content.test.ts
```

Expected: PASS (4 new tests + all pre-existing tests)

- [ ] **Step 5: Update `services/search.ts` to import from `content.ts`**

Add the import at the top of `search.ts`:

```typescript
import { cosineSimilarity } from './content.js';
```

Remove the local `cosineSimilarity` function definition at the bottom of `search.ts` (the full function block, approximately the last 12 lines).

- [ ] **Step 6: Run search tests**

```bash
cd packages/backend && npx vitest run src/services/search.test.ts
```

Expected: PASS — no behaviour changed, function moved

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/content.ts \
        packages/backend/src/services/content.test.ts \
        packages/backend/src/services/search.ts
git commit -m "refactor: move cosineSimilarity utility to content.ts"
```

---

## Task 2: Hoist AI client instantiation in `services/ai.ts`

**Files:**
- Modify: `packages/backend/src/services/ai.ts`

This is a pure internal refactor — no interface change, no new tests. The existing `ai.test.ts` confirms behaviour is preserved.

- [ ] **Step 1: Run existing tests to establish baseline**

```bash
cd packages/backend && npx vitest run src/services/ai.test.ts
```

Expected: PASS — note the count for comparison after change

- [ ] **Step 2: Hoist client creation into the factory**

Inside `createAiService`, before the returned object, create the clients once:

```typescript
export function createAiService(llmConfig: LLMConfig): AiService {
  // Clients created once at construction time, not per-call
  const anthropicClient = llmConfig.provider === 'anthropic'
    ? new Anthropic({ apiKey: llmConfig.apiKey })
    : null;
  const openAiClient = llmConfig.provider !== 'anthropic'
    ? buildOpenAiClient(llmConfig)
    : null;

  return {
    async summarizeEmail(bodyText) {
      const prompt = SUMMARY_PROMPT(bodyText);

      if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: llmConfig.model,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<EmailSummary>(text);
      }

      const response = await openAiClient!.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
      });
      return parseJson<EmailSummary>(response.choices[0]?.message.content ?? '');
    },

    async parseSearchQuery(query) {
      const prompt = PARSE_QUERY_PROMPT(query);

      if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: llmConfig.model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content.find(b => b.type === 'text')?.text ?? '';
        return parseJson<ParsedQuery>(text);
      }

      const response = await openAiClient!.chat.completions.create({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
      });
      return parseJson<ParsedQuery>(response.choices[0]?.message.content ?? '');
    },
  };
}
```

The `buildOpenAiClient` helper function can be removed from the file since it is no longer called — inline its body into the assignment above:

```typescript
const openAiClient = llmConfig.provider !== 'anthropic'
  ? new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseUrl })
  : null;
```

- [ ] **Step 3: Run tests to verify no regression**

```bash
cd packages/backend && npx vitest run src/services/ai.test.ts
```

Expected: same passing count as baseline

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/ai.ts
git commit -m "refactor: hoist AI client instantiation to factory scope"
```

---

## Task 3: Add `archiveEmail` and `trashEmail` to `DbHandle`

**Files:**
- Modify: `packages/backend/src/services/db.ts`
- Modify: `packages/backend/src/services/db.test.ts`

- [ ] **Step 1: Write failing tests in `db.test.ts`**

Add inside the existing `describe('database service', ...)` block, within `describe('emails', ...)`:

```typescript
it('archiveEmail removes INBOX label', () => {
  db.upsertEmail({
    id: 'msg1', threadId: 't1', subject: 'Test', from: 'a@b.com',
    date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
    labels: ['INBOX', 'UNREAD'], summary: null, hasEmbedding: false, embeddingStrategy: null,
  });

  db.archiveEmail('msg1');

  const updated = db.getEmail('msg1');
  expect(updated!.labels).not.toContain('INBOX');
  expect(updated!.labels).toContain('UNREAD');
});

it('archiveEmail is a no-op for unknown id', () => {
  expect(() => db.archiveEmail('nonexistent')).not.toThrow();
});

it('trashEmail adds TRASH label', () => {
  db.upsertEmail({
    id: 'msg2', threadId: 't2', subject: 'Test', from: 'a@b.com',
    date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
    labels: ['INBOX'], summary: null, hasEmbedding: false, embeddingStrategy: null,
  });

  db.trashEmail('msg2');

  const updated = db.getEmail('msg2');
  expect(updated!.labels).toContain('TRASH');
});

it('trashEmail does not duplicate TRASH label', () => {
  db.upsertEmail({
    id: 'msg3', threadId: 't3', subject: 'Test', from: 'a@b.com',
    date: '2026-03-01T00:00:00Z', snippet: '', bodyText: '', bodyHtml: null,
    labels: ['TRASH'], summary: null, hasEmbedding: false, embeddingStrategy: null,
  });

  db.trashEmail('msg3');

  const updated = db.getEmail('msg3');
  expect(updated!.labels.filter(l => l === 'TRASH')).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: FAIL — `archiveEmail` and `trashEmail` do not exist on `DbHandle`

- [ ] **Step 3: Add methods to `DbHandle` interface in `db.ts`**

Add two lines to the `DbHandle` interface after `updateSummary`:

```typescript
archiveEmail(id: string): void;
trashEmail(id: string): void;
```

- [ ] **Step 4: Implement the methods in the `createDb` return object**

Add after the `updateSummary` implementation:

```typescript
archiveEmail(id) {
  const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
  if (!row) return;
  const labels = (JSON.parse(row.labels) as string[]).filter(l => l !== 'INBOX');
  db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(labels), id);
},

trashEmail(id) {
  const row = db.prepare('SELECT labels FROM emails WHERE id = ?').get(id) as { labels: string } | undefined;
  if (!row) return;
  const labels = JSON.parse(row.labels) as string[];
  if (!labels.includes('TRASH')) labels.push('TRASH');
  db.prepare('UPDATE emails SET labels = ? WHERE id = ?').run(JSON.stringify(labels), id);
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/db.test.ts
```

Expected: PASS (4 new tests + all pre-existing tests)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/db.ts \
        packages/backend/src/services/db.test.ts
git commit -m "feat(db): add archiveEmail and trashEmail domain methods"
```

---

## Task 4: Extract `getOrCreateSummary` to `services/email-ops.ts`

**Files:**
- Create: `packages/backend/src/services/email-ops.ts`
- Create: `packages/backend/src/services/email-ops.test.ts`

- [ ] **Step 1: Write failing tests in `email-ops.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { getOrCreateSummary } from './email-ops.js';
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { Email, EmailSummary } from '@gmail-sweep/shared';

const makeEmail = (overrides: Partial<Email> = {}): Email => ({
  id: 'msg1', threadId: 't1', subject: 'Test', from: 'a@b.com',
  date: '2026-03-01T00:00:00Z', snippet: '', bodyText: 'Hello world',
  bodyHtml: null, labels: [], summary: null, hasEmbedding: false,
  embeddingStrategy: null, ...overrides,
});

const mockSummary: EmailSummary = {
  description: 'A test email',
  actionItems: [],
  keyPoints: ['hello'],
};

describe('getOrCreateSummary', () => {
  it('returns null when email does not exist', async () => {
    const db = { getEmail: vi.fn().mockReturnValue(null) } as unknown as DbHandle;
    const ai = {} as AiService;

    const result = await getOrCreateSummary(db, ai, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns existing summary without calling AI', async () => {
    const emailWithSummary = makeEmail({ summary: mockSummary });
    const db = { getEmail: vi.fn().mockReturnValue(emailWithSummary) } as unknown as DbHandle;
    const ai = { summarizeEmail: vi.fn() } as unknown as AiService;

    const result = await getOrCreateSummary(db, ai, 'msg1');

    expect(result).toEqual(mockSummary);
    expect(ai.summarizeEmail).not.toHaveBeenCalled();
  });

  it('generates and stores summary when none exists', async () => {
    const email = makeEmail({ summary: null });
    const updateSummary = vi.fn();
    const db = {
      getEmail: vi.fn().mockReturnValue(email),
      updateSummary,
    } as unknown as DbHandle;
    const ai = { summarizeEmail: vi.fn().mockResolvedValue(mockSummary) } as unknown as AiService;

    const result = await getOrCreateSummary(db, ai, 'msg1');

    expect(ai.summarizeEmail).toHaveBeenCalledWith('Hello world');
    expect(updateSummary).toHaveBeenCalledWith('msg1', mockSummary);
    expect(result).toEqual(mockSummary);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/email-ops.test.ts
```

Expected: FAIL — `email-ops.ts` does not exist

- [ ] **Step 3: Create `services/email-ops.ts`**

```typescript
import type { DbHandle } from './db.js';
import type { AiService } from './ai.js';
import type { EmailSummary } from '@gmail-sweep/shared';

export async function getOrCreateSummary(
  db: DbHandle,
  ai: AiService,
  emailId: string
): Promise<EmailSummary | null> {
  const email = db.getEmail(emailId);
  if (!email) return null;
  if (email.summary) return email.summary;
  const summary = await ai.summarizeEmail(email.bodyText);
  db.updateSummary(emailId, summary);
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/email-ops.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/email-ops.ts \
        packages/backend/src/services/email-ops.test.ts
git commit -m "feat: extract getOrCreateSummary to email-ops service"
```

---

## Task 5: Extract `runSyncWithEmbeddings` to `services/sync.ts`

**Files:**
- Modify: `packages/backend/src/services/sync.ts`
- Modify: `packages/backend/src/services/sync.test.ts`

- [ ] **Step 1: Write failing test in `sync.test.ts`**

First, read the existing `sync.test.ts` to understand the mock/stub pattern in use, then add the following test inside the existing `describe` block (after existing tests):

```typescript
describe('runSyncWithEmbeddings', () => {
  it('returns embeddingsGenerated from embedding pipeline', async () => {
    // Minimal db stub — no emails to sync, no gaps
    const db = {
      getSyncState: vi.fn().mockReturnValue({ totalSynced: 0, newestDate: null, oldestDate: null }),
      getEmail: vi.fn().mockReturnValue(null),
      upsertEmail: vi.fn(),
      updateSyncState: vi.fn(),
      listGaps: vi.fn().mockReturnValue([]),
      getEmailsWithoutEmbedding: vi.fn().mockReturnValue([]),
    } as unknown as DbHandle;

    const gmail = {
      fetchMessagesSince: vi.fn().mockResolvedValue([]),
      fetchMessagesBefore: vi.fn().mockResolvedValue([]),
      fetchMessagesInRange: vi.fn().mockResolvedValue([]),
    } as unknown as GmailService;

    const embed = {
      embedDocument: vi.fn().mockResolvedValue([0.1, 0.2]),
    } as unknown as EmbedService;

    const config: AppConfig = {
      google: { clientId: '', clientSecret: '', redirectUri: '' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      embedding: { provider: 'local', model: 'test', dimension: 2 },
      sync: { defaultBatchSize: 10 },
      contentExtraction: {
        activeStrategy: 'v1-plain',
        strategies: {
          'v1-plain': { type: 'template', template: '{{body_text}}' },
        },
      },
    };

    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: 10 });
    expect(result).toHaveProperty('embeddingsGenerated');
    expect(result.embeddingsGenerated).toBe(0); // no pending emails
  });

  it('skips embeddings when skipEmbeddings is true', async () => {
    const db = {
      getSyncState: vi.fn().mockReturnValue({ totalSynced: 0, newestDate: null, oldestDate: null }),
      getEmail: vi.fn().mockReturnValue(null),
      upsertEmail: vi.fn(),
      updateSyncState: vi.fn(),
      listGaps: vi.fn().mockReturnValue([]),
      getEmailsWithoutEmbedding: vi.fn().mockReturnValue([]),
    } as unknown as DbHandle;

    const gmail = {
      fetchMessagesSince: vi.fn().mockResolvedValue([]),
      fetchMessagesBefore: vi.fn().mockResolvedValue([]),
      fetchMessagesInRange: vi.fn().mockResolvedValue([]),
    } as unknown as GmailService;

    const embed = { embedDocument: vi.fn() } as unknown as EmbedService;

    const config: AppConfig = {
      google: { clientId: '', clientSecret: '', redirectUri: '' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      embedding: { provider: 'local', model: 'test', dimension: 2 },
      sync: { defaultBatchSize: 10 },
      contentExtraction: {
        activeStrategy: 'v1-plain',
        strategies: { 'v1-plain': { type: 'template', template: '{{body_text}}' } },
      },
    };

    const result = await runSyncWithEmbeddings(db, gmail, embed, config, { batchSize: 10, skipEmbeddings: true });
    expect(embed.embedDocument).not.toHaveBeenCalled();
    expect(result.embeddingsGenerated).toBe(0);
  });
});
```

Also add the missing imports at the top of `sync.test.ts`:

```typescript
import type { EmbedService } from './embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import { runSyncWithEmbeddings } from './sync.js';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run src/services/sync.test.ts
```

Expected: FAIL — `runSyncWithEmbeddings` is not exported from `sync.ts`

- [ ] **Step 3: Add `runSyncWithEmbeddings` to `sync.ts`**

Add the following imports at the top of `sync.ts`:

```typescript
import type { EmbedService } from './embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import { generatePendingEmbeddings } from './embeddings.js';
```

Add this constant and function after the existing `runSyncCycle` export:

```typescript
const EMBEDDING_BATCH_SIZE = 50;

export async function runSyncWithEmbeddings(
  db: DbHandle,
  gmail: GmailService,
  embed: EmbedService,
  config: AppConfig,
  options: SyncOptions & { skipEmbeddings?: boolean }
): Promise<SyncResult & { embeddingsGenerated: number }> {
  const syncResult = await runSyncCycle(db, gmail, options);

  let embeddingsGenerated = 0;
  if (!options.skipEmbeddings) {
    const { activeStrategy, strategies } = config.contentExtraction;
    const strategy = strategies[activeStrategy];
    if (strategy) {
      embeddingsGenerated = await generatePendingEmbeddings(
        db, embed, activeStrategy, strategy, EMBEDDING_BATCH_SIZE
      );
    }
  }

  return { ...syncResult, embeddingsGenerated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run src/services/sync.test.ts
```

Expected: PASS (2 new tests + all pre-existing sync tests)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/sync.ts \
        packages/backend/src/services/sync.test.ts
git commit -m "feat(sync): extract runSyncWithEmbeddings orchestration to service layer"
```

---

## Task 6: Thin the route handlers

**Files:**
- Modify: `packages/backend/src/routes/emails.ts`
- Modify: `packages/backend/src/routes/sync.ts`

- [ ] **Step 1: Run route tests to establish baseline**

```bash
cd packages/backend && npx vitest run src/routes/emails.test.ts src/routes/auth.test.ts
```

Note the passing count.

- [ ] **Step 2: Update `routes/emails.ts`**

Replace the entire file content with:

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { AiService } from '../services/ai.js';
import { getOrCreateSummary } from '../services/email-ops.js';
import type { EmailListParams } from '@gmail-sweep/shared';

export async function emailRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; ai: AiService }
) {
  const { db, gmail, ai } = options;

  app.get('/emails', async (request) => {
    const query = request.query as EmailListParams;
    const emails = db.listEmails({
      sender: query.sender,
      date_from: query.date_from,
      date_to: query.date_to,
      subject: query.subject,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    return { emails };
  });

  app.get('/emails/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const email = db.getEmail(id);
    if (!email) return reply.code(404).send({ error: 'Email not found' });
    return email;
  });

  app.get('/emails/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };
    const summary = await getOrCreateSummary(db, ai, id);
    if (!summary) return reply.code(404).send({ error: 'Email not found' });
    return summary;
  });

  app.post('/emails/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    await gmail.archiveMessage(id);
    db.archiveEmail(id);
    return { ok: true };
  });

  app.post('/emails/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!db.getEmail(id)) return reply.code(404).send({ error: 'Email not found' });
    await gmail.deleteMessage(id);
    db.trashEmail(id);
    return { ok: true };
  });
}
```

- [ ] **Step 3: Update `routes/sync.ts`**

Replace the entire file content with:

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../services/db.js';
import type { GmailService } from '../services/gmail.js';
import type { EmbedService } from '../services/embed.js';
import type { AppConfig } from '@gmail-sweep/shared';
import { runSyncWithEmbeddings } from '../services/sync.js';

export async function syncRoutes(
  app: FastifyInstance,
  options: { db: DbHandle; gmail: GmailService; embed: EmbedService; config: AppConfig; defaultBatchSize: number }
) {
  const { db, gmail, embed, config, defaultBatchSize } = options;

  app.post('/sync', async (request) => {
    const body = request.body as { batchSize?: number; skipEmbeddings?: boolean } | undefined;
    const batchSize = body?.batchSize ?? defaultBatchSize;
    const skipEmbeddings = body?.skipEmbeddings ?? false;
    return runSyncWithEmbeddings(db, gmail, embed, config, { batchSize, skipEmbeddings });
  });

  app.get('/sync/status', async () => {
    const state = db.getSyncState();
    const gaps = db.listGaps();
    return {
      totalSynced: state.totalSynced,
      newestDate: state.newestDate,
      oldestDate: state.oldestDate,
      gaps,
      hasGaps: gaps.length > 0,
    };
  });

  app.get('/sync/gaps', async () => {
    const gaps = db.listGaps();
    const totalMissing = gaps.reduce((sum, g) => sum + g.estimatedCount, 0);
    return { gaps, totalMissing };
  });
}
```

- [ ] **Step 4: Run all backend tests**

```bash
cd packages/backend && npx vitest run
```

Expected: PASS — all tests green, no regressions

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/emails.ts \
        packages/backend/src/routes/sync.ts
git commit -m "refactor(routes): thin email and sync handlers — move business logic to service layer"
```

---

## Self-Review

**Spec coverage:**

| Violation | Task |
|-----------|------|
| `cosineSimilarity` misplaced in search.ts | Task 1 ✓ |
| AI client re-instantiated on every call | Task 2 ✓ |
| Label manipulation in archive route | Task 6 via Task 3 ✓ |
| Label manipulation in delete route | Task 6 via Task 3 ✓ |
| Summary orchestration in route handler | Task 6 via Task 4 ✓ |
| `EMBEDDING_BATCH_SIZE` magic number in route | Task 5 ✓ |
| Sync+embeddings orchestration in route | Task 5+6 ✓ |
| Magic `50` default limit in emails route | Task 6 ✓ |

All 8 violations addressed. No placeholders. Type names are consistent across tasks (`DbHandle`, `GmailService`, `EmbedService`, `AiService`, `AppConfig`).
