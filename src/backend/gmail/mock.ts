import type {
  GmailAdapter,
  GmailLabel,
  GmailMessage,
  ListMessagesResult,
  HistoryRecord,
  ListHistoryResult,
} from "./adapter";

export class MockGmailAdapter implements GmailAdapter {
  private messages = new Map<string, GmailMessage>();
  private labels: GmailLabel[] = [];
  private historyRecords: HistoryRecord[] = [];
  private archivedIds: string[] = [];
  private deletedIds: string[] = [];
  private modifyLabelsCalls: { id: string; addLabelIds: string[]; removeLabelIds: string[] }[] = [];
  private historyIdCounter = 1000;
  private failNext = false;

  /** Set to true to make the next archive/delete call throw. */
  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  addMessage(msg: GmailMessage): void {
    this.messages.set(msg.id, msg);
  }

  setLabels(labels: GmailLabel[]): void {
    this.labels = labels;
  }

  addHistoryRecord(record: HistoryRecord): void {
    this.historyRecords.push(record);
  }

  getArchivedIds(): string[] {
    return this.archivedIds;
  }

  getDeletedIds(): string[] {
    return this.deletedIds;
  }

  getModifyLabelsCalls(): { id: string; addLabelIds: string[]; removeLabelIds: string[] }[] {
    return this.modifyLabelsCalls;
  }

  async listMessages(params: {
    maxResults: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<ListMessagesResult> {
    const all = Array.from(this.messages.values());
    const sliced = all.slice(0, params.maxResults);
    return {
      messages: sliced.map((m) => ({ id: m.id, threadId: m.threadId })),
      historyId: String(++this.historyIdCounter),
    };
  }

  async getMessage(id: string): Promise<GmailMessage | null> {
    return this.messages.get(id) ?? null;
  }

  async archive(id: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Mock archive failure");
    }
    this.archivedIds.push(id);
    const msg = this.messages.get(id);
    if (msg) {
      msg.labels = msg.labels.filter((l) => l.id !== "INBOX");
    }
  }

  async delete(id: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Mock delete failure");
    }
    this.deletedIds.push(id);
    const msg = this.messages.get(id);
    if (msg) {
      msg.labels.push({ id: "TRASH", name: "TRASH" });
    }
  }

  async modifyLabels(
    id: string,
    params: { addLabelIds: string[]; removeLabelIds: string[] }
  ): Promise<void> {
    this.modifyLabelsCalls.push({ id, ...params });
    const msg = this.messages.get(id);
    if (msg) {
      for (const labelId of params.removeLabelIds) {
        msg.labels = msg.labels.filter((l) => l.id !== labelId);
      }
      for (const labelId of params.addLabelIds) {
        if (!msg.labels.some((l) => l.id === labelId)) {
          msg.labels.push({ id: labelId, name: labelId });
        }
      }
    }
  }

  async listLabels(): Promise<GmailLabel[]> {
    return this.labels;
  }

  async listHistory(params: {
    startHistoryId: string;
  }): Promise<ListHistoryResult> {
    return {
      history: this.historyRecords,
      historyId: String(++this.historyIdCounter),
    };
  }
}
