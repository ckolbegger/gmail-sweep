export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;           // ISO 8601
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  labels: string[];
  summary: EmailSummary | null;
  removedState?: 'archived' | 'deleted' | null;
}

export interface EmailSummary {
  description: string;
  actionItems: string[];
  keyPoints: string[];
}

export interface Gap {
  id: number;
  newerBoundary: string;
  olderBoundary: string;
  estimatedCount: number;
}

export interface SyncStatus {
  totalSynced: number;
  newestDate: string | null;
  oldestDate: string | null;
  lastHistoryId: string | null;
  hasGaps: boolean;
  gaps: Gap[];
}

export interface SyncResult {
  fetched: number;
  newEmails: number;
  gapsFilled: number;
  olderFetched: number;
  remainingGaps: Gap[];
}

export interface ParsedQuery {
  filters: {
    sender?: string;
    date_from?: string;
    date_to?: string;
    subject?: string;
  };
  semanticQuery: string;
}

export interface SearchRequest {
  query: string;
  limit?: number;
}

export interface SearchResult {
  emails: Email[];
  scores: number[];
}

export interface SummarizerStatus {
  status: 'running' | 'idle';
  processed: number;  // emails processed in the current run (resets each run)
  pending: number;    // emails without a summary (DB count, snapshot at run start)
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface EmbeddingConfig {
  provider: 'local' | 'openai-compatible';
  model: string;
  dimension: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface AppConfig {
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  sync: {
    defaultBatchSize: number;
  };
  contentExtraction: {
    activeStrategy: string;
    strategies: Record<string, ExtractionStrategy>;
  };
  terminal?: {
    summarizerPollIntervalMs?: number;
  };
}

export interface ExtractionStrategy {
  type: 'template';
  template: string;        // e.g. "Subject: {{subject}}\n\n{{body_text}}"
}

export interface EmailListParams {
  sender?: string;
  date_from?: string;
  date_to?: string;
  subject?: string;
  limit?: number;
  offset?: number;
  anchor_unsummarized?: boolean;   // if true, backend anchors results at newest unsummarized email
}
