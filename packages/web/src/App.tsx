import { useState, useEffect, useMemo } from 'react';
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

  const bindings = useMemo(() => view !== 'inbox' ? ({} as Record<string, () => void>) : ({
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
      <div style={styles.statusBar}>
        <span style={styles.appName}>gmail-sweep</span>
        <span style={styles.statusText}>{loading ? 'Loading…' : status}</span>
        <span style={styles.hint}>j/k navigate · Enter open · Tab toggle view · a archive · d delete · / search · r sync · q quit</span>
      </div>

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
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#111', color: '#ccc' },
  statusBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '6px 16px', background: '#0d0d0d', borderBottom: '1px solid #2a2a2a', fontSize: '12px', flexShrink: 0 },
  appName: { fontWeight: 700, color: '#5dade2', letterSpacing: '0.05em' },
  statusText: { color: '#aaa' },
  hint: { marginLeft: 'auto', color: '#555' },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { width: '380px', flexShrink: 0, overflow: 'hidden' },
  preview: { flex: 1, overflow: 'hidden' },
};
