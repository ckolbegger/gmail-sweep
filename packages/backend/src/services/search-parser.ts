export interface ParsedOperatorQuery {
  operators: {
    from?: string;
    to?: string;
    subject?: string;
    before?: string;
    after?: string;
    label?: string;
    is?: 'read' | 'unread' | 'starred';
    has?: 'actions' | 'no-actions';
  };
  freeText: string;
}

const KEYS = new Set(['from', 'to', 'subject', 'before', 'after', 'label', 'is', 'has']);

export function parseOperatorQuery(query: string): ParsedOperatorQuery {
  const operators: ParsedOperatorQuery['operators'] = {};
  const freeTextTokens: string[] = [];
  if (!query.trim()) return { operators, freeText: '' };

  for (const token of query.split(/\s+/)) {
    const idx = token.indexOf(':');
    if (idx > 0) {
      const k = token.substring(0, idx);
      const v = token.substring(idx + 1);
      if (KEYS.has(k) && v) {
        (operators as any)[k] = v;
        continue;
      }
    }
    freeTextTokens.push(token);
  }
  return { operators, freeText: freeTextTokens.join(' ') };
}
