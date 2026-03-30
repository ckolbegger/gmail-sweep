import blessed from "blessed";
import { ApiClient, type EmailSummary } from "./api";
import { createEmailList } from "./components/email-list";
import { createDetailPanel } from "./components/detail-panel";
import { createStatusBar, type StatusBarState } from "./components/status-bar";
import { createSearchBar } from "./components/search-bar";

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
  const searchBar = createSearchBar(screen);

  let running = true;
  let currentMode: AppMode = "inbox";

  // Status polling
  let statusInterval: ReturnType<typeof setInterval>;

  // Global keybindings
  screen.key(["q", "C-c"], () => {
    if (searchBar.isActive()) return; // don't quit while searching
    running = false;
    if (statusInterval) clearInterval(statusInterval);
    screen.destroy();
    process.exit(0);
  });

  screen.key(["j", "down"], () => {
    if (searchBar.isActive()) return;
    emailList.selectDown();
    loadSelectedEmail();
  });

  screen.key(["k", "up"], () => {
    if (searchBar.isActive()) return;
    emailList.selectUp();
    loadSelectedEmail();
  });

  screen.key(["enter"], () => {
    if (searchBar.isActive()) return;
    if (detailPanel.isVisible()) {
      detailPanel.setFullWidth();
    } else {
      detailPanel.setHalfWidth();
    }
  });

  screen.key(["tab"], () => {
    if (searchBar.isActive()) return;
    detailPanel.toggleView();
  });

  // '/' opens search bar
  screen.key(["/"], () => {
    if (searchBar.isActive()) return;
    searchBar.activate({
      onSubmit: async (query: string) => {
        if (!query) {
          currentMode = "inbox";
          loadEmails();
          return;
        }
        currentMode = "search";
        await performSearch(query);
      },
      onCancel: () => {
        if (currentMode === "search") {
          currentMode = "inbox";
          loadEmails();
        }
      },
    });
  });

  // Escape returns to inbox from search
  screen.key(["escape"], () => {
    if (searchBar.isActive()) return;
    if (currentMode === "search") {
      currentMode = "inbox";
      loadEmails();
    }
  });

  // 'e' to archive selected email
  screen.key(["e"], async () => {
    if (searchBar.isActive()) return;
    const selected = emailList.getSelected();
    if (!selected) return;
    try {
      await apiClient.archiveEmail(selected.id);
      emailList.removeSelected();
      loadSelectedEmail();
      await updateStatus();
    } catch {
      statusBar.render({ error: "Archive failed" } as StatusBarState);
    }
  });

  // '#' to delete selected email
  screen.key(["#"], async () => {
    if (searchBar.isActive()) return;
    const selected = emailList.getSelected();
    if (!selected) return;
    try {
      await apiClient.deleteEmail(selected.id);
      emailList.removeSelected();
      loadSelectedEmail();
      await updateStatus();
    } catch {
      statusBar.render({ error: "Delete failed" } as StatusBarState);
    }
  });

  // 'r' to toggle read/unread
  screen.key(["r"], async () => {
    if (searchBar.isActive()) return;
    const selected = emailList.getSelected();
    if (!selected) return;
    try {
      if (selected.is_read) {
        await apiClient.markUnread(selected.id);
        emailList.updateEmail(selected.id, { is_read: false });
      } else {
        await apiClient.markRead(selected.id);
        emailList.updateEmail(selected.id, { is_read: true });
      }
      await updateStatus();
    } catch {
      statusBar.render({ error: "Toggle read failed" } as StatusBarState);
    }
  });

  // 's' to trigger sync
  screen.key(["s"], async () => {
    if (searchBar.isActive()) return;
    try {
      statusBar.render({ syncStatus: "syncing" } as StatusBarState);
      await apiClient.triggerSync();
      setTimeout(() => loadEmails(), 2000);
    } catch {
      statusBar.render({ error: "Sync failed" } as StatusBarState);
    }
  });

  async function performSearch(query: string) {
    try {
      statusBar.render({ mode: "search" } as StatusBarState);
      const response = await apiClient.search(query);
      emailList.setEmails(
        response.results.map((r) => ({
          id: r.id,
          sender: r.sender,
          subject: r.subject,
          date_received: r.date_received,
          is_read: r.is_read,
          is_starred: r.is_starred,
        }))
      );
      loadSelectedEmail();
    } catch {
      statusBar.render({ error: "Search failed" });
    }
  }

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
        mode: currentMode,
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
    searchBar,
  };
}
