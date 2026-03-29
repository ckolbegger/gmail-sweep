import blessed from "blessed";
import { THEME } from "../theme";

export interface SearchBarResult {
  query: string;
}

export function createSearchBar(screen: blessed.Widgets.Screen) {
  let active = false;
  let onSubmit: ((query: string) => void) | null = null;
  let onCancel: (() => void) | null = null;

  const input = blessed.textbox({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: {
      bg: THEME.accent,
      fg: THEME.bg,
    },
    inputOnFocus: true,
  });

  // Start hidden
  input.hide();

  input.key(["enter"], () => {
    const query = input.getValue().trim();
    deactivate();
    onSubmit?.(query);
  });

  input.key(["escape"], () => {
    deactivate();
    onCancel?.();
  });

  function activate(callbacks: {
    onSubmit: (query: string) => void;
    onCancel: () => void;
  }) {
    onSubmit = callbacks.onSubmit;
    onCancel = callbacks.onCancel;
    active = true;
    input.setValue("");
    input.show();
    screen.render();
    input.readInput();
  }

  function deactivate() {
    active = false;
    input.hide();
    screen.render();
  }

  function isActive(): boolean {
    return active;
  }

  return {
    box: input,
    activate,
    deactivate,
    isActive,
  };
}
