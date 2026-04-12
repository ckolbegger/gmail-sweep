import { describe, test, expect } from "bun:test";
import type {
  Email,
  EmailSummary,
  LLMConfig,
  EmbeddingConfig,
  ExtractionStrategy,
  ContentExtractionConfig,
  SummarizerStatus,
} from "@shared/types";

describe("shared types", () => {
  test("Email type is usable at runtime (structurally)", () => {
    const email: Email = {
      id: "1",
      thread_id: "t1",
      sender: "a@b.com",
      recipients: ["c@d.com"],
      subject: "hello",
      body_text: "body",
      body_html: null,
      date_sent: 1000,
      date_received: 1001,
      labels: [{ id: "INBOX", name: "Inbox" }],
      is_read: false,
      is_starred: false,
      ai_status: "pending",
      summary: null,
      action_items: null,
      key_points: null,
      removed_state: null,
    };
    expect(email.id).toBe("1");
    expect(email.ai_status).toBe("pending");
  });

  test("EmbeddingConfig type is usable", () => {
    const cfg: EmbeddingConfig = {
      provider: "local",
      model: "BAAI/bge-m3",
      dimension: 1024,
    };
    expect(cfg.dimension).toBe(1024);
  });

  test("ExtractionStrategy and ContentExtractionConfig types are usable", () => {
    const strategy: ExtractionStrategy = {
      type: "template",
      template: "Subject: {{subject}}\n\n{{body_text}}",
    };
    const config: ContentExtractionConfig = {
      activeStrategy: "default",
      strategies: { default: strategy },
    };
    expect(config.strategies.default.template).toContain("{{subject}}");
  });

  test("SummarizerStatus type is usable", () => {
    const status: SummarizerStatus = { status: "idle", processed: 0, pending: 5 };
    expect(status.status).toBe("idle");
  });

  test("LLMConfig and EmailSummary types are usable", () => {
    const llm: LLMConfig = {
      provider: "openai",
      api_key: "sk-test",
      model: "gpt-4o-mini",
      base_url: "https://api.openai.com/v1",
    };
    const summary: EmailSummary = {
      description: "test",
      actionItems: ["do thing"],
      keyPoints: ["point 1"],
    };
    expect(llm.provider).toBe("openai");
    expect(summary.actionItems).toHaveLength(1);
  });
});
