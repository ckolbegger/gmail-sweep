import { describe, expect, test } from "bun:test";
import { createApp } from "../../packages/backend/src/app";
import type { AppConfig } from "../../packages/shared/src/config";

const fakeConfig: AppConfig = {
  activeAccountId: "fake-account-1",
  gmail: { provider: "fakeGmail" },
  sync: { maxMessagesPerFetch: 100 },
  ai: { provider: "fakeAI", model: "fake-summary" },
  dev: { provider: "fakeGmail", scenario: "seeded" },
  backend: { host: "127.0.0.1", port: 3000 },
};

describe("fake provider probes", () => {
  test("it should report the seeded fake Gmail account and gmail-sweep-test label", async () => {
    const app = createApp({ config: fakeConfig });

    const response = await app.request("/providers/gmail/probe", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: "fakeGmail",
      status: "ok",
      account: {
        id: "fake-account-1",
        email: "fake.user@example.com",
        authenticated: true,
      },
      label: {
        id: "Label_gmail_sweep_test",
        name: "gmail-sweep-test",
      },
    });
  });

  test("it should list a tiny fake test-label message batch", async () => {
    const app = createApp({ config: fakeConfig });

    const response = await app.request("/providers/gmail/probe", { method: "POST" });
    const body = await response.json();

    expect(body.messages).toEqual([
      {
        id: "fake-message-1",
        threadId: "fake-thread-1",
        subject: "Fake sweep test message",
        from: "sender@example.com",
        snippet: "A deterministic fake Gmail message for provider probes.",
        labels: ["Label_gmail_sweep_test"],
      },
      {
        id: "fake-message-2",
        threadId: "fake-thread-2",
        subject: "Second fake sweep test message",
        from: "alerts@example.com",
        snippet: "Another tiny seeded message in gmail-sweep-test.",
        labels: ["Label_gmail_sweep_test"],
      },
    ]);
  });

  test("it should return a deterministic fake AI probe result", async () => {
    const app = createApp({ config: fakeConfig });

    const response = await app.request("/providers/ai/probe", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: "fakeAI",
      status: "ok",
      model: "fake-summary",
      summary: {
        description: "Deterministic fake AI summary for provider probes.",
        actionItems: ["Review gmail-sweep-test messages"],
        keyPoints: ["Fake AI provider is reachable", "No external AI service was called"],
      },
    });
  });
});
