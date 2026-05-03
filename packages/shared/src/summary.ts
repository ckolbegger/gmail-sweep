export interface EmailSummary {
  description: string;
  actionItems: string[];
  keyPoints: string[];
}

export type SummaryStatus =
  | "missing"
  | "queued"
  | "in-progress"
  | "complete"
  | "failed"
  | "rate-limited";
