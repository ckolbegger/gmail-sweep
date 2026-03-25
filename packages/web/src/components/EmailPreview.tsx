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
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#111', color: '#ccc' },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: '14px' },
  header: { padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexShrink: 0 },
  headerMeta: { flex: 1, minWidth: 0 },
  subject: { fontSize: '15px', fontWeight: 600, color: '#eee', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: '12px', color: '#888', display: 'flex', gap: '8px', flexWrap: 'wrap' },
  dot: { color: '#555' },
  labels: { color: '#5dade2' },
  actions: { display: 'flex', gap: '8px', flexShrink: 0 },
  btn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  btnDanger: { color: '#e74c3c', borderColor: '#5a2020' },
  body: { flex: 1, overflow: 'auto' },
  plainText: { padding: '16px', fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ccc', margin: 0 },
  iframe: { width: '100%', height: '100%', border: 'none', background: '#fff' },
  sectionHeader: { fontSize: '11px', letterSpacing: '0.08em', color: '#888', marginBottom: '8px', marginTop: '16px' },
  list: { paddingLeft: '20px', lineHeight: 1.6, fontSize: '14px' },
};
