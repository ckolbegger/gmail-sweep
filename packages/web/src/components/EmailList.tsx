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
