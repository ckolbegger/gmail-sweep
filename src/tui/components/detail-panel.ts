import blessed from "blessed";
import { THEME } from "../theme";
import type { EmailDetail } from "../api";

export function createDetailPanel(screen: blessed.Widgets.Screen) {
  let showingFullWidth = false;
  let viewMode: "summary" | "full" = "full";

  const panel = blessed.box({
    parent: screen,
    top: 0,
    right: 0,
    width: "50%",
    bottom: 1,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    tags: true,
    style: {
      bg: THEME.bg,
      fg: THEME.fg,
    },
    border: {
      type: "line",
    },
    label: " Email ",
  });

  let currentEmail: EmailDetail | null = null;

  function showEmail(email: EmailDetail | null) {
    currentEmail = email;
    viewMode = defaultViewMode(email);
    render();
  }

  function toggleView() {
    viewMode = viewMode === "summary" ? "full" : "summary";
    render();
  }

  function render() {
    if (!currentEmail) {
      panel.setContent("{center}{gray-fg}Select an email to view{/gray-fg}{/center}");
      panel.setLabel(" Email ");
      screen.render();
      return;
    }

    const e = currentEmail;
    const modeLabel = viewMode === "summary" ? "[summary]" : "[full]";
    panel.setLabel(` Email ${modeLabel} `);

    const header = `{bold}${e.subject}{/bold}\n{gray-fg}From:{/gray-fg} ${e.sender}\n{gray-fg}Date:{/gray-fg} ${new Date(e.date_received).toLocaleString()}\n${"─".repeat(40)}`;
    panel.setContent(`${header}\n\n${getEmailContent(e, viewMode)}`);
    screen.render();
  }

  function toggleVisibility() {
    showingFullWidth = !showingFullWidth;
    if (showingFullWidth) {
      panel.width = "100%";
      panel.left = 0;
    } else {
      panel.width = "50%";
      panel.left = "50%";
    }
    screen.render();
  }

  function setFullWidth() {
    showingFullWidth = true;
    panel.width = "100%";
    panel.left = 0;
    screen.render();
  }

  function setHalfWidth() {
    showingFullWidth = false;
    panel.width = "50%";
    panel.left = "50%";
    screen.render();
  }

  function isVisible() {
    return !showingFullWidth;
  }

  return {
    box: panel,
    showEmail,
    toggleView,
    toggleVisibility,
    setFullWidth,
    setHalfWidth,
    isVisible,
  };
}

export function getEmailContent(
  email: {
    body_text: string;
    summary: string | null;
    action_items: string[] | null;
    key_points: string[] | null;
  },
  viewMode: "summary" | "full"
): string {
  if (viewMode === "summary" && email.summary) {
    let content = email.summary;
    if (email.action_items && email.action_items.length > 0) {
      content += "\n\n{bold}Action Items:{/bold}\n" + email.action_items.map((a) => `• ${a}`).join("\n");
    }
    if (email.key_points && email.key_points.length > 0) {
      content += "\n\n{bold}Key Points:{/bold}\n" + email.key_points.map((k) => `• ${k}`).join("\n");
    }
    return content;
  }
  return email.body_text || "(no text content)";
}

export function defaultViewMode(
  email: { summary: string | null } | null
): "summary" | "full" {
  if (email?.summary) return "summary";
  return "full";
}
