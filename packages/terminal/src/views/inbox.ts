import { BoxRenderable, TextRenderable, ScrollBoxRenderable } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildInboxView(renderer: any) {
  const root = new BoxRenderable(renderer, { id: 'inbox-root' });
  root.flexDirection = 'row';
  root.width = '100%';
  root.height = '100%';

  const listPane = new BoxRenderable(renderer, {
    id: 'list-pane',
    border: true,
    title: ' Inbox ',
    titleAlignment: 'left',
  });
  listPane.flexGrow = 1;
  listPane.height = '100%';

  const listScroll = new ScrollBoxRenderable(renderer, { id: 'list-scroll', scrollY: true });
  listScroll.width = '100%';
  listScroll.height = '100%';
  listPane.add(listScroll);

  const previewPane = new BoxRenderable(renderer, {
    id: 'preview-pane',
    border: true,
    title: ' Preview  [Tab: toggle summary/full text] ',
    titleAlignment: 'left',
  });
  previewPane.flexGrow = 2;
  previewPane.height = '100%';

  const previewText = new TextRenderable(renderer, { id: 'preview-text', content: '' });
  previewText.width = '100%';
  previewText.padding = 1;
  previewPane.add(previewText);

  root.add(listPane);
  root.add(previewPane);

  function render(state: AppState): void {
    renderList(state);
    renderPreview(state);
  }

  function renderList(state: AppState): void {
    for (const child of listScroll.getChildren()) {
      listScroll.remove((child as any).id);
    }

    if (state.emails.length === 0) {
      const empty = new TextRenderable(renderer, { id: 'list-empty', content: '  (no emails — press r to sync)' });
      listScroll.add(empty);
      return;
    }

    state.emails.forEach((email, i) => {
      const selected = i === state.selectedIndex;
      const date = email.date.slice(0, 10);
      const from = truncate(email.from, 20);
      const subject = truncate(email.subject, 38);
      const marker = selected ? '▶' : ' ';
      const line = `${marker} ${date}  ${from.padEnd(22)}  ${subject}`;

      const item = new TextRenderable(renderer, { id: `list-item-${i}`, content: line });
      item.width = '100%';
      if (selected) {
        item.backgroundColor = '#1a5276';
      }
      listScroll.add(item);
    });

    if (state.emails.length > 0) {
      listScroll.scrollChildIntoView(`list-item-${state.selectedIndex}`);
    }
  }

  function renderPreview(state: AppState): void {
    const email = state.emails[state.selectedIndex];
    if (!email) {
      previewText.content = '';
      return;
    }

    const header = [
      `Subject: ${email.subject}`,
      `From:    ${email.from}`,
      `Date:    ${email.date}`,
      `Labels:  ${email.labels.join(', ')}`,
      '',
    ];

    if (state.previewMode === 'summary' && email.summary) {
      const s = email.summary;
      previewText.content = [
        ...header,
        s.description,
        '',
        'ACTION ITEMS',
        ...s.actionItems.map(a => `  • ${a}`),
        '',
        'KEY POINTS',
        ...s.keyPoints.map(k => `  • ${k}`),
      ].join('\n');
    } else if (state.previewMode === 'summary') {
      previewText.content = [
        ...header,
        '(loading summary — press Tab for full text)',
      ].join('\n');
    } else {
      previewText.content = [...header, email.bodyText].join('\n');
    }
  }

  return { root, render };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 2) + '..' : s;
}
