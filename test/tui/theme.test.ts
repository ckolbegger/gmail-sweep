import { describe, it, expect } from "bun:test";
import { loadTheme, THEMES } from "@tui/theme";

describe("Theme", () => {
  it("should load the configured theme by name", () => {
    const theme = loadTheme("tokyo-night");
    expect(theme.bg).toBeDefined();
    expect(theme.fg).toBeDefined();
  });

  it("should apply tokyo-night theme colors as default", () => {
    const theme = loadTheme();
    expect(theme.bg).toBe("#1a1b26");
    expect(theme.fg).toBe("#c0caf5");
  });

  it("should throw with a clear message for unknown theme names", () => {
    expect(() => loadTheme("nonexistent")).toThrow(/unknown theme/i);
  });

  it("should define colors for: background, foreground, accent, muted, error, success", () => {
    const theme = loadTheme("tokyo-night");
    expect(theme.bg).toBeDefined();
    expect(theme.fg).toBeDefined();
    expect(theme.accent).toBeDefined();
    expect(theme.muted).toBeDefined();
    expect(theme.error).toBeDefined();
    expect(theme.success).toBeDefined();
  });
});
