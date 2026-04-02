import blessed from "blessed";
import { THEME } from "../theme";
import type { EmailSummary } from "../api";

export function createEmailList(screen: blessed.Widgets.Screen) {
  const list = blessed.list({
    parent: screen,
    top: 0,
    left: 0,
    width: "50%",
    bottom: 1,
    keys: false,
    mouse: true,
    vi: false,
    style: {
      bg: THEME.bg,
      fg: THEME.fg,
      selected: {
        bg: THEME.accent,
        fg: THEME.bg,
        bold: true,
      },
    },
    tags: true,
    scrollbar: {
      ch: "│",
      style: {
        fg: THEME.muted,
      },
    },
  });

  let emails: EmailSummary[] = [];
  let selectedIndex = 0;

  function setEmails(newEmails: EmailSummary[]) {
    emails = newEmails;
    selectedIndex = 0;
    render();
  }

  function render() {
    const items = emails.map((email) => {
      const unread = !email.is_read ? "{bold}{cyan-fg}●{/bold}{/cyan-fg}" : " ";
      const star = email.is_starred ? "{yellow-fg}★{/yellow-fg}" : " ";
      const sender = (email.sender || "").split("<")[0].trim().slice(0, 20);
      const subject = (email.subject || "(no subject)").slice(0, 35);
      const time = formatTime(email.date_received);
      return `${unread} ${star} ${sender.padEnd(20)} ${subject.padEnd(35)} ${time}`;
    });

    list.setItems(items);
    if (selectedIndex < emails.length) {
      list.select(selectedIndex);
    }
    screen.render();
  }

  function selectDown() {
    if (selectedIndex < emails.length - 1) {
      selectedIndex++;
      list.select(selectedIndex);
      screen.render();
    }
  }

  function selectUp() {
    if (selectedIndex > 0) {
      selectedIndex--;
      list.select(selectedIndex);
      screen.render();
    }
  }

  function getSelected(): EmailSummary | null {
    return emails[selectedIndex] ?? null;
  }

  function removeSelected() {
    const wasLast = selectedIndex >= emails.length - 1;
    emails.splice(selectedIndex, 1);
    if (wasLast && selectedIndex > 0) {
      selectedIndex--;
    }
    if (emails.length === 0) {
      selectedIndex = 0;
    }
    render();
  }

  function updateEmail(id: string, updates: Partial<EmailSummary>) {
    const idx = emails.findIndex((e) => e.id === id);
    if (idx >= 0) {
      emails[idx] = { ...emails[idx], ...updates };
      render();
    }
  }

  return {
    box: list,
    setEmails,
    selectDown,
    selectUp,
    getSelected,
    removeSelected,
    updateEmail,
  };
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
