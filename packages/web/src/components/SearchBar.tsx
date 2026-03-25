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
          {!loading && results.length === 0 && <div style={styles.hint}>Type a query and press Enter</div>}
          {!loading && results.map((email, i) => (
            <div key={email.id} style={styles.resultRow} onClick={() => onSelectResult(email)}>
              <span style={styles.resultDate}>{email.date.slice(0, 10)}</span>
              <span style={styles.resultFrom}>{truncate(email.from, 25)}</span>
              <span style={styles.resultSubject}>{email.subject}</span>
              {scores[i] != null && <span style={styles.resultScore}>{Math.round(scores[i]! * 100)}%</span>}
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
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px', zIndex: 100 },
  panel: { background: '#1a1a1a', border: '1px solid #444', borderRadius: '8px', width: '700px', maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  inputRow: { display: 'flex', borderBottom: '1px solid #333' },
  input: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#eee', fontSize: '16px', padding: '16px' },
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: '16px', padding: '16px', cursor: 'pointer' },
  results: { overflowY: 'auto', flex: 1 },
  hint: { padding: '16px', color: '#666', fontSize: '13px' },
  resultRow: { display: 'flex', gap: '12px', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #2a2a2a', fontSize: '13px', color: '#ccc', alignItems: 'baseline' },
  resultDate: { flexShrink: 0, color: '#888', fontSize: '11px', width: '80px' },
  resultFrom: { flexShrink: 0, width: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resultSubject: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  resultScore: { flexShrink: 0, color: '#5dade2', fontSize: '11px', width: '36px', textAlign: 'right' },
};
