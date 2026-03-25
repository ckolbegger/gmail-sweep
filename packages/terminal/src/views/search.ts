import { BoxRenderable, TextRenderable, ScrollBoxRenderable, InputRenderable, InputRenderableEvents } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildSearchView(renderer: any, onSearch: (query: string) => void) {
  const root = new BoxRenderable(renderer, { id: 'search-root' });
  root.flexDirection = 'column';
  root.width = '100%';
  root.height = '100%';

  const inputBox = new BoxRenderable(renderer, {
    id: 'search-input-box',
    border: true,
    title: ' Search  [Enter: search  Esc: cancel] ',
    titleAlignment: 'left',
  });
  inputBox.width = '100%';
  inputBox.height = 5;

  const input = new InputRenderable(renderer, {
    id: 'search-input',
    placeholder: 'Natural language query, e.g. "emails from Sarah about the deadline"',
    onSubmit: () => {
      const q = input.value.trim();
      if (q) onSearch(q);
    },
  });
  input.width = '100%';
  inputBox.add(input);

  const resultsBox = new BoxRenderable(renderer, {
    id: 'search-results-box',
    border: true,
    title: ' Results ',
    titleAlignment: 'left',
  });
  resultsBox.width = '100%';
  resultsBox.flexGrow = 1;

  const resultsList = new ScrollBoxRenderable(renderer, { id: 'results-scroll', scrollY: true });
  resultsList.width = '100%';
  resultsList.height = '100%';
  resultsBox.add(resultsList);

  root.add(inputBox);
  root.add(resultsBox);

  function focusInput(): void {
    input.focus();
  }

  function render(state: AppState): void {
    for (const child of resultsList.getChildren()) {
      resultsList.remove((child as any).id);
    }

    if (state.loading) {
      resultsList.add(new TextRenderable(renderer, { id: 'r-loading', content: '  Searching…' }));
      return;
    }

    if (state.searchResults.length === 0) {
      resultsList.add(new TextRenderable(renderer, {
        id: 'r-empty',
        content: '  No results. Type a query above and press Enter.',
      }));
      return;
    }

    state.searchResults.forEach((email, i) => {
      const date = email.date.slice(0, 10);
      const from = truncate(email.from, 20);
      const subject = truncate(email.subject, 46);
      const score = state.searchScores[i];
      const scoreStr = score != null ? `  ${Math.round(score * 100)}%` : '';
      const line = `  ${date}  ${from.padEnd(22)}  ${subject}${scoreStr}`;
      const item = new TextRenderable(renderer, { id: `result-${i}`, content: line });
      item.width = '100%';
      resultsList.add(item);
    });
  }

  return { root, render, focusInput };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 2) + '..' : s;
}
