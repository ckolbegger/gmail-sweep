export interface GmailLabel {
  id: string;
  name: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  dateSent: number;
  dateReceived: number;
  labels: GmailLabel[];
  isRead: boolean;
  isStarred: boolean;
}

export interface ListMessagesResult {
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
  historyId: string;
}

export interface HistoryRecord {
  id: string;
  messagesAdded?: { id: string; threadId: string }[];
  messagesDeleted?: { id: string; threadId: string }[];
  labelsChanged?: { id: string; threadId: string; addedLabels?: string[]; removedLabels?: string[] }[];
}

export interface ListHistoryResult {
  history: HistoryRecord[];
  historyId: string;
}

export interface GmailAdapter {
  listMessages(params: {
    maxResults: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<ListMessagesResult>;

  getMessage(id: string): Promise<GmailMessage | null>;

  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  modifyLabels(
    id: string,
    params: { addLabelIds: string[]; removeLabelIds: string[] }
  ): Promise<void>;

  listLabels(): Promise<GmailLabel[]>;

  listHistory(params: {
    startHistoryId: string;
  }): Promise<ListHistoryResult>;
}
