import { describe, it, expect } from "bun:test";
import { getEmailContent, defaultViewMode } from "@tui/components/detail-panel";

describe("detail panel content selection", () => {
  it("shows body_text in full mode", () => {
    const email = { body_text: "full body", body_html: "", summary: "short summary", action_items: null, key_points: null };
    expect(getEmailContent(email, "full")).toBe("full body");
  });

  it("shows summary in summary mode when available", () => {
    const email = { body_text: "full body", body_html: "", summary: "short summary", action_items: null, key_points: null };
    expect(getEmailContent(email, "summary")).toBe("short summary");
  });

  it("falls back to body_text in summary mode when summary is null", () => {
    const email = { body_text: "full body", body_html: "", summary: null, action_items: null, key_points: null };
    expect(getEmailContent(email, "summary")).toBe("full body");
  });

  it("shows no content placeholder when body_text is empty", () => {
    const email = { body_text: "", body_html: "", summary: null, action_items: null, key_points: null };
    expect(getEmailContent(email, "full")).toBe("(no text content)");
  });

  it("includes action items in summary mode", () => {
    const email = {
      body_text: "full body",
      body_html: "",
      summary: "short summary",
      action_items: ["Review the report", "Reply by Friday"],
      key_points: null,
    };
    const result = getEmailContent(email, "summary");
    expect(result).toContain("short summary");
    expect(result).toContain("Review the report");
    expect(result).toContain("Reply by Friday");
  });

  it("includes key points in summary mode", () => {
    const email = {
      body_text: "full body",
      body_html: "",
      summary: "short summary",
      action_items: null,
      key_points: ["Revenue up 12%", "New product launch Q3"],
    };
    const result = getEmailContent(email, "summary");
    expect(result).toContain("short summary");
    expect(result).toContain("Revenue up 12%");
    expect(result).toContain("New product launch Q3");
  });

  it("includes all three sections when present", () => {
    const email = {
      body_text: "full body",
      body_html: "",
      summary: "short summary",
      action_items: ["Call Sarah"],
      key_points: ["Budget approved"],
    };
    const result = getEmailContent(email, "summary");
    expect(result).toContain("short summary");
    expect(result).toContain("Call Sarah");
    expect(result).toContain("Budget approved");
  });

  it("falls back to HTML when body_text is empty but body_html has content", () => {
    const email = { body_text: "", body_html: "<p>Hello from HTML</p>", summary: null, action_items: null, key_points: null };
    const result = getEmailContent(email, "full");
    expect(result).toContain("Hello from HTML");
    expect(result).not.toContain("<p>");
  });

  it("does not show action items section when null or empty", () => {
    const email = {
      body_text: "full body",
      body_html: "",
      summary: "short summary",
      action_items: null,
      key_points: null,
    };
    const result = getEmailContent(email, "summary");
    expect(result).not.toContain("Action Items");
    expect(result).not.toContain("Key Points");
  });
});

describe("default view mode", () => {
  it("defaults to summary when email has a summary", () => {
    const email = { summary: "a summary" };
    expect(defaultViewMode(email)).toBe("summary");
  });

  it("defaults to full when email has no summary", () => {
    const email = { summary: null };
    expect(defaultViewMode(email)).toBe("full");
  });

  it("defaults to full when email is null", () => {
    expect(defaultViewMode(null)).toBe("full");
  });
});
