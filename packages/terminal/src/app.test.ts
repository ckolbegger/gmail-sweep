import { describe, it, expect } from 'vitest';
import {
  createAppState, setEmails, nextEmail, prevEmail, selectEmail,
  togglePreview, archiveEmail, deleteEmail, backToInbox, startSearch,
  setSearchResults, setStatus, setSummarizerStatus,
} from './app.js';
import type { Email, SummarizerStatus } from '@gmail-sweep/shared';

function makeEmail(id: string): Email {
  return {
    id, threadId: 'thread1', subject: `Subject ${id}`, from: 'a@b.com',
    date: '2026-01-01T00:00:00Z', snippet: '', bodyText: 'body', bodyHtml: null,
    labels: ['INBOX'], summary: null,
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

  it('setSummarizerStatus updates summarizerStatus in state', () => {
    const state = createAppState();
    expect(state.summarizerStatus).toBeNull();
    const status: SummarizerStatus = { status: 'running', processed: 1, pending: 5 };
    const updated = setSummarizerStatus(state, status);
    expect(updated.summarizerStatus).toEqual(status);
  });
});
