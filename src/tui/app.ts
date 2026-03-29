import blessed from "blessed";
import { ApiClient, type EmailSummary } from "./api";
import { createEmailList } from "./components/email-list";
import { createDetailPanel } from "./components/detail-panel";
import { createStatusBar, type StatusBarState } from "./components/status-bar";

export type AppMode = "inbox" | "search";

export function createTuiApp(apiClient: ApiClient) {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Gmail Sweep",
    fullUnicode: true,
  });

  const emailList = createEmailList(screen);
  const detailPanel = createDetailPanel(screen);
  const statusBar = createStatusBar(screen);

  let running = true;
  let currentMode: AppMode = "inbox";

  // Status polling
  let statusInterval: ReturnType<typeof setInterval>;

  // Global keybindings
  screen.key(["q", "C-c"], () => {
    running = false;
    if (statusInterval) clearInterval(statusInterval);
    screen.destroy();
    process.exit(0);
  });

  screen.key(["j", "down"], () => {
    emailList.selectDown();
    loadSelectedEmail();
  });

  screen.key(["k", "up"], () => {
    emailList.selectUp();
    loadSelectedEmail();
  });

  screen.key(["enter"], () => {
    if (detailPanel.isVisible()) {
      detailPanel.setFullWidth();
    } else {
      detailPanel.setHalfWidth();
    }
  });

  screen.key(["tab"], () => {
    detailPanel.toggleView();
  });

  async function loadEmails() {
    try {
      const response = await apiClient.getEmails();
      emailList.setEmails(response.emails);
      loadSelectedEmail();
      await updateStatus();
    } catch {
      statusBar.render({ error: "Cannot reach backend" });
    }
  }

  async function loadSelectedEmail() {
    const selected = emailList.getSelected();
    if (!selected) {
      detailPanel.showEmail(null);
      return;
    }
    try {
      const email = await apiClient.getEmail(selected.id);
      detailPanel.showEmail(email as any);
    } catch {
      detailPanel.showEmail(null);
    }
  }

  async function updateStatus() {
    try {
      const authStatus = await apiClient.getAuthStatus();
      const syncStatus = await apiClient.getSyncStatus();
      statusBar.render({
        authStatus: authStatus.authorized ? "authorized" : "unauthorized",
        unreadCount: syncStatus.unreadCount,
        totalEmails: syncStatus.totalEmails,
      });
    } catch {
      statusBar.render({ error: "Connection error" });
    }
  }

  // Initial load
  loadEmails();

  // Poll status every 30s
  statusInterval = setInterval(updateStatus, 30_000);

  return {
    screen,
    getRunning: () => running,
    loadEmails,
  };
}
