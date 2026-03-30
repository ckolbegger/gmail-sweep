import { describe, it, expect } from "bun:test";
import { formatStatusBar } from "../../src/tui/components/status-bar";

describe("status bar formatting", () => {
  it("shows Auth OK and unread count", () => {
    expect(formatStatusBar({ authStatus: "authorized", unreadCount: 5 })).toContain("Auth OK");
    expect(formatStatusBar({ authStatus: "authorized", unreadCount: 5 })).toContain("5 unread");
  });

  it("shows gap count when gaps exist", () => {
    expect(formatStatusBar({ authStatus: "authorized", unreadCount: 5, gapCount: 3 })).toContain("3 gaps");
  });

  it("hides gap count when no gaps", () => {
    expect(formatStatusBar({ authStatus: "authorized", unreadCount: 5, gapCount: 0 })).not.toContain("gaps");
  });

  it("shows Syncing status", () => {
    expect(formatStatusBar({ authStatus: "authorized", syncStatus: "syncing" })).toContain("Syncing...");
  });

  it("shows error message", () => {
    expect(formatStatusBar({ authStatus: "authorized", error: "Connection error" })).toContain("Connection error");
  });
});
