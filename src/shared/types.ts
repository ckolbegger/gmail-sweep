export interface EmailSummary {
  description: string;
  actionItems: string[];
  keyPoints: string[];
}

export interface Email {
  id: string;
  thread_id: string;
  sender: string;
  recipients: string[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  date_sent: number;
  date_received: number;
  labels: Array<{ id: string; name: string }>;
  is_read: boolean;
  is_starred: boolean;
  ai_status: "pending" | "processing" | "done" | "failed";
  summary: string | null;
  action_items: string[] | null;
  key_points: string[] | null;
  removed_state: "archived" | "deleted" | null;
}

export interface LLMConfig {
  provider: "openai" | "anthropic";
  api_key: string;
  model: string;
  base_url: string;
}

export interface EmbeddingConfig {
  provider: "local" | "openai-compatible";
  model: string;
  dimension: number;
  api_key?: string;
  base_url?: string;
}

export interface ExtractionStrategy {
  type: "template";
  template: string;
}

export interface ContentExtractionConfig {
  activeStrategy: string;
  strategies: Record<string, ExtractionStrategy>;
}

export interface SummarizerStatus {
  status: "running" | "idle";
  processed: number;
  pending: number;
}
