import blessed from "blessed";
import { ApiClient } from "./api";
import { THEME } from "./theme";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export function createTuiApp(apiClient: ApiClient) {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Gmail Sweep",
    fullUnicode: true,
  });

  const statusBox = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "50%",
    height: 3,
    align: "center",
    valign: "middle",
    tags: true,
    style: {
      bg: THEME.bg,
      fg: THEME.fg,
    },
  });

  let state: ConnectionState = "connecting";
  let running = true;

  async function checkConnection() {
    try {
      state = "connecting";
      renderStatus();
      await apiClient.getStatus();
      state = "connected";
    } catch {
      state = "disconnected";
    }
    renderStatus();
  }

  function renderStatus() {
    switch (state) {
      case "connected":
        statusBox.setContent("{green-fg}Connected to backend{/green-fg}");
        break;
      case "disconnected":
        statusBox.setContent("{red-fg}Cannot reach backend{/red-fg}");
        break;
      case "connecting":
        statusBox.setContent("{yellow-fg}Connecting...{/yellow-fg}");
        break;
    }
    screen.render();
  }

  screen.key(["q", "C-c"], () => {
    running = false;
    screen.destroy();
    process.exit(0);
  });

  checkConnection();

  return {
    screen,
    getStatusBox: () => statusBox,
    getState: () => state,
    getRunning: () => running,
    checkConnection,
  };
}
