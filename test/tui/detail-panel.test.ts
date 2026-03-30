import { describe, it, expect } from "bun:test";
import { getEmailContent } from "@tui/components/detail-panel";

describe("detail panel content selection", () => {
  it("shows body_text in full mode", () => {
    const email = { body_text: "full body", summary: "short summary" };
    expect(getEmailContent(email, "full")).toBe("full body");
  });

  it("shows summary in summary mode when available", () => {
    const email = { body_text: "full body", summary: "short summary" };
    expect(getEmailContent(email, "summary")).toBe("short summary");
  });

  it("falls back to body_text in summary mode when summary is null", () => {
    const email = { body_text: "full body", summary: null };
    expect(getEmailContent(email, "summary")).toBe("full body");
  });

  it("shows no content placeholder when body_text is empty", () => {
    const email = { body_text: "", summary: null };
    expect(getEmailContent(email, "full")).toBe("(no text content)");
  });
});
