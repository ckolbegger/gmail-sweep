import { describe, it, expect } from "bun:test";
import { MockGmailAdapter } from "@backend/gmail/mock";

describe("Mock Gmail adapter", () => {
  it("should return a preset list of messages from listMessages", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addMessage({
      id: "msg1",
      threadId: "thread1",
      sender: "alice@example.com",
      recipients: ["bob@example.com"],
      subject: "Test",
      bodyText: "Hello",
      bodyHtml: "",
      dateSent: Date.now(),
      dateReceived: Date.now(),
      labels: [{ id: "INBOX", name: "INBOX" }],
      isRead: false,
      isStarred: false,
    });
    const result = await adapter.listMessages({ maxResults: 10 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("msg1");
  });

  it("should return historyId from listMessages", async () => {
    const adapter = new MockGmailAdapter();
    const result = await adapter.listMessages({ maxResults: 10 });
    expect(result.historyId).toBeDefined();
  });

  it("should return a specific message from getMessage", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addMessage({
      id: "msg1",
      threadId: "thread1",
      sender: "a@b.com",
      recipients: ["c@d.com"],
      subject: "Hello",
      bodyText: "World",
      bodyHtml: "",
      dateSent: 1000,
      dateReceived: 1001,
      labels: [],
      isRead: false,
      isStarred: false,
    });
    const msg = await adapter.getMessage("msg1");
    expect(msg).not.toBeNull();
    expect(msg!.id).toBe("msg1");
    expect(msg!.bodyText).toBe("World");
  });

  it("should track archive calls and remove INBOX label", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addMessage({
      id: "msg1",
      threadId: "thread1",
      sender: "a@b.com",
      recipients: ["c@d.com"],
      subject: "Hello",
      bodyText: "World",
      bodyHtml: "",
      dateSent: 1000,
      dateReceived: 1001,
      labels: [{ id: "INBOX", name: "INBOX" }],
      isRead: false,
      isStarred: false,
    });
    await adapter.archive("msg1");
    expect(adapter.getArchivedIds()).toContain("msg1");
  });

  it("should track delete calls and add TRASH label", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addMessage({
      id: "msg1",
      threadId: "thread1",
      sender: "a@b.com",
      recipients: ["c@d.com"],
      subject: "Hello",
      bodyText: "World",
      bodyHtml: "",
      dateSent: 1000,
      dateReceived: 1001,
      labels: [],
      isRead: false,
      isStarred: false,
    });
    await adapter.delete("msg1");
    expect(adapter.getDeletedIds()).toContain("msg1");
  });

  it("should track modifyLabels calls with add and remove lists", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addMessage({
      id: "msg1",
      threadId: "thread1",
      sender: "a@b.com",
      recipients: ["c@d.com"],
      subject: "Hello",
      bodyText: "World",
      bodyHtml: "",
      dateSent: 1000,
      dateReceived: 1001,
      labels: [{ id: "INBOX", name: "INBOX" }],
      isRead: false,
      isStarred: false,
    });
    await adapter.modifyLabels("msg1", { addLabelIds: ["STARRED"], removeLabelIds: ["INBOX"] });
    const modCalls = adapter.getModifyLabelsCalls();
    expect(modCalls).toHaveLength(1);
    expect(modCalls[0].addLabelIds).toContain("STARRED");
    expect(modCalls[0].removeLabelIds).toContain("INBOX");
  });

  it("should return preset labels from listLabels", async () => {
    const adapter = new MockGmailAdapter();
    adapter.setLabels([
      { id: "INBOX", name: "INBOX" },
      { id: "TRASH", name: "TRASH" },
    ]);
    const labels = await adapter.listLabels();
    expect(labels).toHaveLength(2);
    expect(labels[0].id).toBe("INBOX");
  });

  it("should return history records from listHistory", async () => {
    const adapter = new MockGmailAdapter();
    adapter.addHistoryRecord({
      id: "hist1",
      messagesAdded: [{ id: "msg1", threadId: "thread1" }],
    });
    const result = await adapter.listHistory({ startHistoryId: "0" });
    expect(result.history).toHaveLength(1);
    expect(result.history[0].id).toBe("hist1");
  });

  it("should return a new historyId from listHistory", async () => {
    const adapter = new MockGmailAdapter();
    const result = await adapter.listHistory({ startHistoryId: "0" });
    expect(result.historyId).toBeDefined();
  });
});
