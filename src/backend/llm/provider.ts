// LAN LLM proxy rejects requests with max_tokens below this floor.
export const MIN_MAX_TOKENS = 2048;

export interface ParsedQuery {
  filters: { sender?: string; date_from?: string; date_to?: string; subject?: string };
  semanticQuery: string;
}

export interface LLMProvider {
  summarize(email: {
    sender: string;
    subject: string;
    body: string;
  }): Promise<SummaryResult>;
  parseSearchQuery(query: string): Promise<ParsedQuery>;
}

export interface SummaryResult {
  summary: string;
  actionItems: string[];
  keyPoints: string[];
  model: string;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
