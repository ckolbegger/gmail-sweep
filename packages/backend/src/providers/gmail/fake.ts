import type { AppConfig } from "@gmail-sweep/shared/src/config";
import type { GmailProbeResult, GmailProvider } from "./types";

const testLabel = {
  id: "Label_gmail_sweep_test",
  name: "gmail-sweep-test",
};

const testMessages = [
  {
    id: "fake-message-1",
    threadId: "fake-thread-1",
    subject: "Fake sweep test message",
    from: "sender@example.com",
    snippet: "A deterministic fake Gmail message for provider probes.",
    labels: [testLabel.id],
  },
  {
    id: "fake-message-2",
    threadId: "fake-thread-2",
    subject: "Second fake sweep test message",
    from: "alerts@example.com",
    snippet: "Another tiny seeded message in gmail-sweep-test.",
    labels: [testLabel.id],
  },
];

export function createFakeGmailProvider(config: AppConfig): GmailProvider {
  return {
    async probe(): Promise<GmailProbeResult> {
      return {
        provider: "fakeGmail",
        status: "ok",
        account: {
          id: config.activeAccountId ?? "fake-account-1",
          email: "fake.user@example.com",
          authenticated: true,
        },
        label: testLabel,
        messages: testMessages,
      };
    },
  };
}
