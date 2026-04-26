import type { Email, SummarizerStatus } from '@gmail-sweep/shared';

export type View = 'inbox' | 'email' | 'search';
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
  return { ...s, emails, selectedIndex: Math.min(s.selectedIndex, Math.max(0, emails.length - 1)) };
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
