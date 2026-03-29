import blessed from "blessed";
import { THEME } from "../theme";

export interface StatusBarState {
  authStatus?: "authorized" | "unauthorized";
  syncStatus?: "idle" | "syncing" | "error";
  lastSyncTime?: number;
  totalEmails?: number;
  unreadCount?: number;
  mode?: "inbox" | "search";
  error?: string;
}

export function createStatusBar(screen: blessed.Widgets.Screen) {
  const bar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    style: {
      bg: THEME.accent,
      fg: THEME.bg,
    },
  });

  function render(state: StatusBarState) {
    const parts: string[] = [];

    if (state.authStatus === "authorized") {
      parts.push("Auth OK");
    } else {
      parts.push("Not Auth");
    }

    if (state.syncStatus === "syncing") {
      parts.push("Syncing...");
    } else if (state.syncStatus === "error") {
      parts.push("Sync Error");
    }

    if (state.unreadCount !== undefined) {
      parts.push(`${state.unreadCount} unread`);
    }

    if (state.error) {
      parts.push(state.error);
    }

    const rightParts = [
      "{bold}j{/bold}/{bold}k{/bold}nav  {bold}Enter{/bold}view  {bold}s{/bold}sync  {bold}q{/bold}uit",
    ];

    const left = parts.join(" | ");
    const right = rightParts.join("  ");
    const padding = Math.max(1, (bar.width as number) - left.length - right.length - 4);

    bar.setContent(` ${left}${" ".repeat(padding)}${right}`);
    screen.render();
  }

  return { box: bar, render };
}
