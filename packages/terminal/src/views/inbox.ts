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
  listPane.flexShrink = 1;
  listPane.height = '100%';
  listPane.overflow = 'hidden';

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
  previewPane.width = '40%';
  previewPane.flexShrink = 0;
  previewPane.height = '100%';
  previewPane.overflow = 'hidden';

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
    const s = state.summarizerStatus;
    const summaryInfo = s?.status === 'running'
      ? `  ·  Summarising: ${s.processed}/${s.pending}`
      : '';
    listPane.title = ` Inbox${summaryInfo} `;

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
        item.bg = '#1a5276';
      }
      listScroll.add(item);
    });

    if (state.emails.length > 0) {
      setTimeout(() => listScroll.scrollChildIntoView(`list-item-${state.selectedIndex}`), 0);
    }
  }

  function renderPreview(state: AppState): void {
    const email = state.emails[state.selectedIndex];
    if (!email) {
      previewText.content = '';
      return;
    }

    const w = 55;
    const header = [
      truncate(`Subject: ${email.subject}`, w),
      truncate(`From:    ${email.from}`, w),
      truncate(`Date:    ${email.date}`, w),
      truncate(`Labels:  ${email.labels.join(', ')}`, w),
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
