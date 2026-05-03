import type { EmailSummary, SummaryStatus } from "./summary";

export type SystemLabelCategory =
  | "personal"
  | "social"
  | "promotions"
  | "updates"
  | "forums";

export interface SystemLabelState {
  unread: boolean;
  inbox: boolean;
  trash: boolean;
  spam: boolean;
  sent: boolean;
  draft: boolean;
  starred: boolean;
  important: boolean;
  category: SystemLabelCategory | null;
}

export type BodyAuditSource = "text/plain" | "text/html" | "none";

export type BodyAuditReason =
  | "plain-text-present"
  | "html-converted"
  | "empty-body"
  | "unsupported-mime";

export interface BodyAudit {
  source: BodyAuditSource;
  reason: BodyAuditReason;
}

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  date: string;
  snippet: string;
  labels: string[];
  system: SystemLabelState;
  userLabels: string[];
  bodyText: string;
  bodyHtml: string | null;
  bodyAudit: BodyAudit;
  summary: EmailSummary | null;
  summaryStatus: SummaryStatus;
}
