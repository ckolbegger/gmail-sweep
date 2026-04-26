import { describe, it, expect } from 'vitest';
import {
  createAppState, setEmails, refreshEmails, nextEmail, prevEmail, selectEmail,
  togglePreview, archiveEmail, deleteEmail, backToInbox, startSearch,
  setSearchResults, setStatus, setSummarizerStatus, toggleDetailFullWidth, showHelp, clearSearch,
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

  it('refreshEmails replaces list and preserves selectedIndex', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b'), makeEmail('c')]);
    s = nextEmail(nextEmail(s)); // move to index 2
    s = refreshEmails(s, [makeEmail('a'), makeEmail('b'), makeEmail('c')]);
    expect(s.selectedIndex).toBe(2);
  });

  it('refreshEmails clamps selectedIndex if new list is shorter', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b'), makeEmail('c')]);
    s = nextEmail(nextEmail(s)); // index 2
    s = refreshEmails(s, [makeEmail('a')]);
    expect(s.selectedIndex).toBe(0);
  });

  it('refreshEmails updates openEmail if it is in the new list', () => {
    const old = makeEmail('a');
    let s = setEmails(createAppState(), [old]);
    s = { ...s, openEmail: old };
    const updated = { ...old, summary: { description: 'summary', actionItems: [], keyPoints: [] } };
    s = refreshEmails(s, [updated]);
    expect(s.openEmail?.summary?.description).toBe('summary');
  });

  it('refreshEmails leaves openEmail null if no email is open', () => {
    let s = setEmails(createAppState(), [makeEmail('a')]);
    const updated = makeEmail('a');
    s = refreshEmails(s, [updated]);
    expect(s.openEmail).toBeNull();
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

  it('detailFullWidth starts false and toggleDetailFullWidth toggles it', () => {
    let s = createAppState();
    expect(s.detailFullWidth).toBe(false);
    s = toggleDetailFullWidth(s);
    expect(s.detailFullWidth).toBe(true);
    s = toggleDetailFullWidth(s);
    expect(s.detailFullWidth).toBe(false);
  });

  it('showHelp sets view to help', () => {
    const s = showHelp(createAppState());
    expect(s.view).toBe('help');
  });

  it('backToInbox from help returns to inbox', () => {
    const s = backToInbox(showHelp(createAppState()));
    expect(s.view).toBe('inbox');
  });

  it('setSearchResults stores query and clamps selectedIndex', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b'), makeEmail('c')]);
    s = nextEmail(nextEmail(s)); // index 2
    s = setSearchResults(s, [makeEmail('x')], [0.9], 'test query');
    expect(s.searchResults).toHaveLength(1);
    expect(s.searchQuery).toBe('test query');
    expect(s.selectedIndex).toBe(0);
  });

  it('clearSearch resets search state', () => {
    let s = setSearchResults(createAppState(), [makeEmail('x')], [0.9], 'hello');
    s = clearSearch(s);
    expect(s.searchResults).toHaveLength(0);
    expect(s.searchScores).toHaveLength(0);
    expect(s.searchQuery).toBe('');
  });

  it('selectEmail opens from searchResults when filter is active', () => {
    const inbox = makeEmail('inbox');
    const result = makeEmail('result');
    let s = setEmails(createAppState(), [inbox]);
    s = setSearchResults(s, [result], [0.9], 'q');
    s = selectEmail(s, 0);
    expect(s.openEmail?.id).toBe('result');
  });

  it('selectEmail opens from emails when no filter', () => {
    const inbox = makeEmail('inbox');
    let s = setEmails(createAppState(), [inbox]);
    s = selectEmail(s, 0);
    expect(s.openEmail?.id).toBe('inbox');
  });

  it('archiveEmail removes from both emails and searchResults', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    s = setSearchResults(s, [makeEmail('a'), makeEmail('b')], [1, 0.9], 'q');
    s = archiveEmail(s, 'a');
    expect(s.emails.map(e => e.id)).toEqual(['b']);
    expect(s.searchResults.map(e => e.id)).toEqual(['b']);
  });

  it('deleteEmail removes from both emails and searchResults', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    s = setSearchResults(s, [makeEmail('a'), makeEmail('b')], [1, 0.9], 'q');
    s = deleteEmail(s, 'a');
    expect(s.emails.map(e => e.id)).toEqual(['b']);
    expect(s.searchResults.map(e => e.id)).toEqual(['b']);
  });

  it('archiveEmail clamps index against active list when filtering', () => {
    let s = setEmails(createAppState(), [makeEmail('a'), makeEmail('b')]);
    s = setSearchResults(s, [makeEmail('a')], [1], 'q');
    s = { ...s, selectedIndex: 0 };
    s = archiveEmail(s, 'a');
    expect(s.selectedIndex).toBe(0);
  });
});
