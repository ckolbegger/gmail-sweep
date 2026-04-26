import { BoxRenderable, TextRenderable } from '@opentui/core';

const HELP_TEXT = `
  NAVIGATION
  ──────────────────────────────────────
  ↑ / ↓          Move selection
  Enter           Open email
  Esc             Back to inbox
  q               Quit

  PREVIEW
  ──────────────────────────────────────
  Tab             Toggle summary / full text
  [ / ]           Scroll preview up / down
  f               Toggle full-width detail panel

  ACTIONS
  ──────────────────────────────────────
  e               Archive email
  #               Delete email
  r               Sync (full)

  SEARCH
  ──────────────────────────────────────
  /               Open search
  Operators:      from:  subject:  label:
                  is:unread  has:actions
                  before:YYYY-MM-DD  after:YYYY-MM-DD

  ?               Show this help
`.trimStart();

export function buildHelpView(renderer: any) {
  const root = new BoxRenderable(renderer, {
    id: 'help-root',
    border: true,
    title: ' Key Bindings  [Esc or ? to close] ',
    titleAlignment: 'left',
  });
  root.width = '100%';
  root.height = '100%';

  const text = new TextRenderable(renderer, { id: 'help-text', content: HELP_TEXT });
  text.width = '100%';
  text.padding = 1;
  root.add(text);

  function render() {}

  return { root, render };
}
