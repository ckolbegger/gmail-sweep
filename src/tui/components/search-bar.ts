import blessed from "blessed";
import { THEME } from "../theme";

export const SEARCH_BAR_OPTIONS = {
  top: 0,
  left: 0,
  width: "100%",
  height: 1,
  style: {
    bg: THEME.accent,
    fg: THEME.bg,
  },
  inputOnFocus: false,
} as const;

export function createSearchBar(screen: blessed.Widgets.Screen) {
  let active = false;
  let onSubmit: ((query: string) => void) | null = null;
  let onCancel: (() => void) | null = null;

  const input = blessed.textbox({
    parent: screen,
    ...SEARCH_BAR_OPTIONS,
  });

  // Start hidden
  input.hide();

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
    input.readInput((err, value) => {
      // Defer to avoid mutating blessed state during key event processing
      setTimeout(() => {
        deactivate();
        if (err || value == null) {
          onCancel?.();
        } else {
          onSubmit?.(value.trim());
        }
      }, 0);
    });
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
