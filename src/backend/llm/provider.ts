export interface LLMProvider {
  summarize(email: {
    sender: string;
    subject: string;
    body: string;
  }): Promise<SummaryResult>;
}

export interface SummaryResult {
  summary: string;
  actionItems: string[];
  keyPoints: string[];
  model: string;
}
