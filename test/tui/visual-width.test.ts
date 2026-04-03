import { describe, it, expect } from "bun:test";
import {
  visualWidth,
  truncateToWidth,
  padEndWidth,
  wrapText,
} from "../../src/tui/visual-width";

describe("visualWidth", () => {
  it("counts ASCII as 1 cell per char", () => {
    expect(visualWidth("hello")).toBe(5);
  });

  it("counts emoji as 2 cells", () => {
    expect(visualWidth("📌")).toBe(2);
  });

  it("counts emoji + variation selector as 2 cells (VS is 0-width)", () => {
    // ☕️ = ☕ (U+2615, 2 cells) + ️ (U+FE0F, 0 cells) = 2 cells total
    expect(visualWidth("☕️")).toBe(2);
  });

  it("counts mixed ASCII and emoji", () => {
    expect(visualWidth("📌 Hello")).toBe(8);
  });

  it("counts CJK as 2 cells", () => {
    expect(visualWidth("日本語")).toBe(6);
  });
});

describe("truncateToWidth", () => {
  it("returns short strings unchanged", () => {
    expect(truncateToWidth("hello", 10)).toBe("hello");
  });

  it("truncates ASCII at width boundary", () => {
    expect(truncateToWidth("hello world", 5)).toBe("hello");
  });

  it("does not split an emoji that would exceed width", () => {
    // "📌a" = 3 cells. Truncate to 2 cells = "📌" (2 cells)
    expect(truncateToWidth("📌a", 2)).toBe("📌");
  });

  it("drops emoji entirely if it won't fit", () => {
    // Truncate to 1 cell: emoji needs 2, so skip it
    expect(truncateToWidth("📌hello", 1)).toBe("");
  });

  it("handles emoji in the middle", () => {
    // "ab📌cd" = 2+2+2 = 6 cells. Truncate to 4 = "ab📌"
    expect(truncateToWidth("ab📌cd", 4)).toBe("ab📌");
  });
});

describe("padEndWidth", () => {
  it("pads ASCII to target visual width", () => {
    expect(padEndWidth("hi", 5)).toBe("hi   ");
  });

  it("pads after emoji correctly", () => {
    // "📌" is 2 cells, pad to 5 = 3 spaces
    expect(padEndWidth("📌", 5)).toBe("📌   ");
  });

  it("returns unchanged if already at target width", () => {
    expect(padEndWidth("hello", 5)).toBe("hello");
  });

  it("handles mixed content", () => {
    // "📌ab" = 4 cells, pad to 6 = 2 spaces
    expect(padEndWidth("📌ab", 6)).toBe("📌ab  ");
  });
});

describe("wrapText", () => {
  it("returns short lines unchanged", () => {
    expect(wrapText("hello world", 40)).toBe("hello world");
  });

  it("wraps at spaces", () => {
    expect(wrapText("one two three four", 8)).toBe("one two \nthree \nfour");
  });

  it("force-breaks long unbroken strings", () => {
    expect(wrapText("abcdefghij", 4)).toBe("abcd\nefgh\nij");
  });

  it("preserves existing newlines", () => {
    expect(wrapText("hello\nworld", 40)).toBe("hello\nworld");
  });

  it("force-breaks URLs", () => {
    const url = "https://example.com/very/long/path/here";
    expect(wrapText(url, 20).split("\n").every((line) => visualWidth(line) <= 20)).toBe(true);
  });
});
