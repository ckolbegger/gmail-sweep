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
  listPane.width = '35%';
  listPane.flexShrink = 0;
  listPane.height = '100%';
  listPane.overflow = 'hidden';

  const listScroll = new ScrollBoxRenderable(renderer, { id: 'list-scroll', scrollY: true });
  listScroll.width = '100%';
  listScroll.height = '100%';
  listPane.add(listScroll);

  const previewPane = new BoxRenderable(renderer, {
    id: 'preview-pane',
    border: true,
    title: '',
    titleAlignment: 'left',
  });
  previewPane.flexGrow = 1;
  previewPane.height = '100%';
  previewPane.overflow = 'hidden';

  const previewScroll = new ScrollBoxRenderable(renderer, { id: 'preview-scroll', scrollY: true });
  previewScroll.width = '100%';
  previewScroll.height = '100%';

  const previewText = new TextRenderable(renderer, { id: 'preview-text', content: '' });
  previewText.width = '100%';
  previewText.padding = 1;
  previewScroll.add(previewText);
  previewPane.add(previewScroll);

  root.add(listPane);
  root.add(previewPane);

  function render(state: AppState): void {
    renderList(state);
    renderPreview(state);
  }

  function renderList(state: AppState): void {
    const isFiltering = state.searchResults.length > 0;
    const activeEmails = isFiltering ? state.searchResults : state.emails;

    if (isFiltering) {
      listPane.title = ` Search: "${state.searchQuery}"  [/: clear] `;
    } else {
      const s = state.summarizerStatus;
      const summaryInfo = s?.status === 'running'
        ? `  ·  Summarising: ${s.processed}/${s.pending}`
        : '';
      listPane.title = ` Inbox${summaryInfo} `;
    }

    for (const child of listScroll.getChildren()) {
      listScroll.remove((child as any).id);
    }

    if (activeEmails.length === 0) {
      const msg = isFiltering ? '  (no results)' : '  (no emails — press r to sync)';
      const empty = new TextRenderable(renderer, { id: 'list-empty', content: msg });
      listScroll.add(empty);
      return;
    }

    const listPaneWidth = Math.floor((process.stdout.columns ?? 120) * 0.35);
    const subjectWidth = Math.max(10, listPaneWidth - 45);

    activeEmails.forEach((email, i) => {
      const selected = i === state.selectedIndex;
      const date = email.date.slice(0, 10);
      const from = truncate(email.from, 20);
      const subject = truncate(email.subject, subjectWidth);
      const marker = selected ? '▶' : ' ';
      const line = `${marker} ${date}  ${from.padEnd(22)}  ${subject}`;

      const item = new TextRenderable(renderer, { id: `list-item-${i}`, content: line });
      item.width = '100%';
      if (selected) {
        item.bg = '#1a5276';
      }
      listScroll.add(item);
    });

    setTimeout(() => listScroll.scrollChildIntoView(`list-item-${state.selectedIndex}`), 0);
  }

  function renderPreview(state: AppState): void {
    const summary  = state.previewMode === 'summary'  ? '[summary]' : ' summary ';
    const fulltext = state.previewMode === 'fulltext' ? '[full text]' : ' full text ';
    previewPane.title = ` Preview  Tab:${summary}/${fulltext} `;

    const activeEmails = state.searchResults.length > 0 ? state.searchResults : state.emails;
    const email = activeEmails[state.selectedIndex];
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

  const SCROLL_STEP = 3;
  function scrollUp()   { previewScroll.scrollTo(Math.max(0, previewScroll.scrollTop - SCROLL_STEP)); }
  function scrollDown() { previewScroll.scrollTo(previewScroll.scrollTop + SCROLL_STEP); }

  return { root, render, scrollUp, scrollDown };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 2) + '..' : s;
}
