export interface Theme {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  error: string;
  success: string;
  warning: string;
}

export const THEMES: Record<string, Theme> = {
  "tokyo-night": {
    bg: "#1a1b26",
    fg: "#c0caf5",
    accent: "#7aa2f7",
    muted: "#565f89",
    error: "#f7768e",
    success: "#9ece6a",
    warning: "#e0af68",
  },
  "catppuccin-mocha": {
    bg: "#1e1e2e",
    fg: "#cdd6f4",
    accent: "#89b4fa",
    muted: "#6c7086",
    error: "#f38ba8",
    success: "#a6e3a1",
    warning: "#f9e2af",
  },
  "dracula": {
    bg: "#282a36",
    fg: "#f8f8f2",
    accent: "#bd93f9",
    muted: "#6272a4",
    error: "#ff5555",
    success: "#50fa7b",
    warning: "#f1fa8c",
  },
  "gruvbox-dark": {
    bg: "#282828",
    fg: "#ebdbb2",
    accent: "#83a598",
    muted: "#665c54",
    error: "#fb4934",
    success: "#b8bb26",
    warning: "#fabd2f",
  },
};

export const THEME = THEMES["tokyo-night"];

export function loadTheme(name?: string): Theme {
  const themeName = name ?? "tokyo-night";
  const theme = THEMES[themeName];
  if (!theme) {
    throw new Error(`Unknown theme: "${themeName}". Available: ${Object.keys(THEMES).join(", ")}`);
  }
  return theme;
}
