import type { Email, SummarizerStatus } from '@gmail-sweep/shared';

export type View = 'inbox' | 'email' | 'search' | 'help';
export type PreviewMode = 'summary' | 'fulltext';

export interface AppState {
  emails: Email[];
  selectedIndex: number;
  view: View;
  openEmail: Email | null;
  previewMode: PreviewMode;
  detailFullWidth: boolean;
  searchQuery: string;
  searchResults: Email[];
  searchScores: number[];
  status: string;
  loading: boolean;
  summarizerStatus: SummarizerStatus | null;
}

export function createAppState(): AppState {
  return {
    emails: [],
    selectedIndex: 0,
    view: 'inbox',
    openEmail: null,
    previewMode: 'summary',
    detailFullWidth: false,
    searchQuery: '',
    searchResults: [],
    searchScores: [],
    status: 'Ready',
    loading: false,
    summarizerStatus: null,
  };
}

export function setEmails(s: AppState, emails: Email[]): AppState {
  return { ...s, emails, selectedIndex: 0 };
}

export function refreshEmails(s: AppState, emails: Email[]): AppState {
  const openEmail = s.openEmail ? (emails.find(e => e.id === s.openEmail!.id) ?? s.openEmail) : null;
  return { ...s, emails, openEmail, selectedIndex: Math.min(s.selectedIndex, Math.max(0, emails.length - 1)) };
}

/** The list the inbox is showing: search results when a filter is active, otherwise all emails. */
export function getActiveEmails(s: AppState): Email[] {
  return s.searchResults.length > 0 ? s.searchResults : s.emails;
}

export function nextEmail(s: AppState): AppState {
  const activeLength = getActiveEmails(s).length;
  if (activeLength === 0) return s;
  return { ...s, selectedIndex: Math.min(s.selectedIndex + 1, activeLength - 1) };
}

export function prevEmail(s: AppState): AppState {
  return { ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) };
}

export function selectEmail(s: AppState, index: number): AppState {
  return { ...s, view: 'email', openEmail: getActiveEmails(s)[index] ?? null, previewMode: 'summary' };
}

export function togglePreview(s: AppState): AppState {
  return { ...s, previewMode: s.previewMode === 'summary' ? 'fulltext' : 'summary' };
}

function removeEmail(s: AppState, id: string): AppState {
  const emails = s.emails.filter(e => e.id !== id);
  const searchResults = s.searchResults.filter(e => e.id !== id);
  // Guard on the pre-removal state: an active filter stays active for this
  // clamp even if its last result was just removed.
  const activeLength = s.searchResults.length > 0 ? searchResults.length : emails.length;
  return { ...s, emails, searchResults, selectedIndex: Math.min(s.selectedIndex, Math.max(0, activeLength - 1)) };
}

export function archiveEmail(s: AppState, id: string): AppState {
  return removeEmail(s, id);
}

export function deleteEmail(s: AppState, id: string): AppState {
  return removeEmail(s, id);
}

export function backToInbox(s: AppState): AppState {
  return { ...s, view: 'inbox', openEmail: null };
}

export function showHelp(s: AppState): AppState {
  return { ...s, view: 'help' };
}

export function startSearch(s: AppState): AppState {
  return { ...s, view: 'search', searchQuery: '', searchResults: [] };
}

export function setSearchResults(s: AppState, emails: Email[], scores: number[], query: string): AppState {
  const selectedIndex = Math.min(s.selectedIndex, Math.max(0, emails.length - 1));
  return { ...s, searchResults: emails, searchScores: scores, searchQuery: query, selectedIndex };
}

export function clearSearch(s: AppState): AppState {
  return { ...s, searchResults: [], searchScores: [], searchQuery: '' };
}

export function setStatus(s: AppState, status: string): AppState {
  return { ...s, status };
}

export function setLoading(s: AppState, loading: boolean): AppState {
  return { ...s, loading };
}

export function setSummarizerStatus(s: AppState, status: SummarizerStatus): AppState {
  return { ...s, summarizerStatus: status };
}

export function updateOpenEmail(s: AppState, updated: Email): AppState {
  return {
    ...s,
    openEmail: s.openEmail?.id === updated.id ? updated : s.openEmail,
    emails: s.emails.map(e => e.id === updated.id ? updated : e),
  };
}

export function toggleDetailFullWidth(s: AppState): AppState {
  return { ...s, detailFullWidth: !s.detailFullWidth };
}
