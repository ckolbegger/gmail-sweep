// test/backend/content.test.ts
import { describe, it, expect } from "bun:test";
import { htmlToText, extractBodyText, isHtmlFallbackStub } from "@backend/services/content";

describe("htmlToText", () => {
  it("strips HTML tags from a simple email", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    const result = htmlToText(html);
    expect(result).toContain("Hello world");
    expect(result).not.toContain("<p>");
  });

  it("handles a multi-paragraph email", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const result = htmlToText(html);
    expect(result).toContain("First paragraph");
    expect(result).toContain("Second paragraph");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });

  it("handles email with links without outputting URLs", () => {
    const html = '<div><p>Click here to <a href="https://example.com">unsubscribe</a></p><p>Your actual content</p></div>';
    const result = htmlToText(html);
    expect(result).toContain("unsubscribe");
    expect(result).toContain("Your actual content");
    expect(result).not.toContain("https://example.com");
  });
});

describe("isHtmlFallbackStub", () => {
  it("detects 'not support html'", () => {
    expect(isHtmlFallbackStub("Your client does not support HTML email.")).toBe(true);
  });

  it("detects \"doesn't support html\"", () => {
    expect(isHtmlFallbackStub("Your client doesn't support HTML.")).toBe(true);
  });

  it("detects 'html formatted email'", () => {
    expect(isHtmlFallbackStub("email client might not support HTML formatted email.")).toBe(true);
  });

  it("detects 'in another email client'", () => {
    expect(isHtmlFallbackStub("Try opening this email in another email client.")).toBe(true);
  });

  it("detects 'plain text version not available'", () => {
    expect(isHtmlFallbackStub("Plain text version not available.")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHtmlFallbackStub("NOT SUPPORT HTML FORMATTED EMAIL")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(isHtmlFallbackStub("Here is your weekly digest")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isHtmlFallbackStub("")).toBe(false);
  });
});

describe("extractBodyText", () => {
  const CNN_STUB = [
    "It looks like your email client might not support HTML formatted email.",
    "Try opening this email in another email client.",
    "Or, open the following link to view this email in a browser:",
    "https://example.com/view",
  ].join("\n");

  it("returns plain text when present and not a stub", () => {
    expect(extractBodyText("Hello world", "<p>Hello world</p>")).toBe("Hello world");
  });

  it("falls back to HTML-converted text when plain text is null", () => {
    expect(extractBodyText(null, "<p>Hello world</p>")).toBe("Hello world");
  });

  it("falls back to HTML-converted text when plain text is empty string", () => {
    expect(extractBodyText("", "<p>Hello world</p>")).toBe("Hello world");
  });

  it("falls back to HTML-converted text when plain text is whitespace only", () => {
    expect(extractBodyText("   ", "<p>Hello world</p>")).toBe("Hello world");
  });

  it("returns empty string when both are null/empty", () => {
    expect(extractBodyText(null, null)).toBe("");
    expect(extractBodyText(null, "")).toBe("");
    expect(extractBodyText("", null)).toBe("");
  });

  it("uses HTML when plain text is an HTML-fallback stub", () => {
    expect(extractBodyText("Your client does not support HTML email.", "<p>Real content</p>")).toBe("Real content");
  });

  it("uses HTML for the CNN stub pattern", () => {
    expect(extractBodyText(CNN_STUB, "<p>Five good things.</p>")).toBe("Five good things.");
  });

  it("returns stub as last resort when no HTML is available", () => {
    expect(extractBodyText(CNN_STUB, null)).toBe(CNN_STUB.trim());
  });
});
