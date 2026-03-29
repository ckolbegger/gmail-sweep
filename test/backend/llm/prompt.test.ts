import { describe, it, expect } from "bun:test";
import { buildSummaryPrompt } from "@backend/llm/prompt";

describe("buildSummaryPrompt", () => {
  const email = {
    sender: "alice@example.com",
    subject: "Project Update",
    body: "We finished the first milestone ahead of schedule.",
  };

  it("should include system prompt defining output format", () => {
    const { system } = buildSummaryPrompt(email);
    expect(system).toContain("summary");
    expect(system).toContain("action_items");
    expect(system).toContain("key_points");
  });

  it("should request one-sentence summary with no filler", () => {
    const { system } = buildSummaryPrompt(email);
    expect(system).toMatch(/one.?sentence/i);
    expect(system).toMatch(/no filler/i);
  });

  it("should request action items as JSON array of strings", () => {
    const { system } = buildSummaryPrompt(email);
    expect(system).toMatch(/action_items.*array/i);
  });

  it("should request key points as JSON array of strings", () => {
    const { system } = buildSummaryPrompt(email);
    expect(system).toMatch(/key_points.*array/i);
  });

  it("should force JSON output format", () => {
    const { system } = buildSummaryPrompt(email);
    expect(system).toMatch(/JSON/i);
    expect(system).toContain("summary");
    expect(system).toContain("action_items");
    expect(system).toContain("key_points");
  });

  it("should include email sender, subject, and body in user message", () => {
    const { user } = buildSummaryPrompt(email);
    expect(user).toContain("alice@example.com");
    expect(user).toContain("Project Update");
    expect(user).toContain("We finished the first milestone ahead of schedule.");
  });
});
