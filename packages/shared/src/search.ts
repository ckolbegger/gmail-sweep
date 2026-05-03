export type SearchHasOperator = "attachment";

export type SearchStateOperator = "unread" | "read" | "starred" | "important";

export interface SearchQuery {
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  labelIds?: string[];
  is?: SearchStateOperator[];
  has?: SearchHasOperator[];
  before?: string;
  after?: string;
}
