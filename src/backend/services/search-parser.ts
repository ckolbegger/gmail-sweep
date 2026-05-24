export interface ParsedQuery {
  operators: Record<string, string>;
  freeText: string;
}

const OPERATOR_PREFIXES = [
  "from",
  "to",
  "subject",
  "before",
  "after",
  "label",
  "is",
  "has",
];

export function parseQuery(query: string): ParsedQuery {
  const operators: Record<string, string> = {};
  const freeTextTokens: string[] = [];

  if (!query.trim()) {
    return { operators, freeText: "" };
  }

  // Tokenizer: split on whitespace but keep quoted segments together
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  for (const token of tokens) {
    const colonIndex = token.indexOf(":");
    if (colonIndex > 0 && !token.startsWith('"')) {
      const prefix = token.substring(0, colonIndex);
      let value = token.substring(colonIndex + 1);
      if (OPERATOR_PREFIXES.includes(prefix)) {
        // Strip surrounding quotes from value
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
          value = value.slice(1, -1);
        }
        operators[prefix] = value;
        continue;
      }
    }
    freeTextTokens.push(token);
  }

  return {
    operators,
    freeText: freeTextTokens.join(" "),
  };
}

export function buildSqlFilters(
  parsed: ParsedQuery
): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  const { operators } = parsed;

  if (operators.from) {
    clauses.push("sender LIKE ?");
    params.push(`%${operators.from}%`);
  }

  if (operators.to) {
    clauses.push("recipients LIKE ?");
    params.push(`%${operators.to}%`);
  }

  if (operators.subject) {
    clauses.push("subject LIKE ?");
    params.push(`%${operators.subject}%`);
  }

  if (operators.before) {
    clauses.push("date_received < ?");
    params.push(new Date(`${operators.before}T00:00:00Z`).getTime());
  }

  if (operators.after) {
    clauses.push("date_received > ?");
    params.push(new Date(`${operators.after}T00:00:00Z`).getTime());
  }

  if (operators.label) {
    clauses.push(
      "id IN (SELECT e.id FROM emails e, json_each(e.labels) WHERE json_extract(json_each.value, '$.name') = ?)"
    );
    params.push(operators.label);
  }

  if (operators.is === "unread") {
    clauses.push("is_read = 0");
  } else if (operators.is === "read") {
    clauses.push("is_read = 1");
  } else if (operators.is === "starred") {
    clauses.push("is_starred = 1");
  }

  if (operators.has === "actions") {
    clauses.push("json_array_length(action_items) > 0");
  } else if (operators.has === "no-actions") {
    clauses.push("json_array_length(action_items) = 0");
  }

  return {
    where: clauses.join(" AND "),
    params,
  };
}
