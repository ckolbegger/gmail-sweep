import { BoxRenderable, TextRenderable, ScrollBoxRenderable } from '@opentui/core';
import type { AppState } from '../app.js';

export function buildEmailView(renderer: any) {
  const root = new BoxRenderable(renderer, {
    id: 'email-root',
    border: true,
    title: ' Email  [Tab: toggle  Esc: back  a: archive  d: delete] ',
    titleAlignment: 'left',
  });
  root.width = '100%';
  root.height = '100%';

  const scroll = new ScrollBoxRenderable(renderer, { id: 'email-scroll', scrollY: true });
  scroll.width = '100%';
  scroll.height = '100%';

  const content = new TextRenderable(renderer, { id: 'email-content', content: '' });
  content.width = '100%';
  content.padding = 1;
  scroll.add(content);
  root.add(scroll);

  function render(state: AppState): void {
    const email = state.openEmail;
    if (!email) return;

    scroll.scrollTo(0);

    const header = [
      `Subject: ${email.subject}`,
      `From:    ${email.from}`,
      `Date:    ${email.date}`,
      `Labels:  ${email.labels.join(', ')}`,
      '',
    ];

    if (state.previewMode === 'summary' && email.summary) {
      const s = email.summary;
      content.content = [
        ...header,
        '─── AI SUMMARY ───────────────────────────────',
        '',
        s.description,
        '',
        'ACTION ITEMS',
        ...s.actionItems.map(a => `  • ${a}`),
        '',
        'KEY POINTS',
        ...s.keyPoints.map(k => `  • ${k}`),
      ].join('\n');
    } else if (state.previewMode === 'summary') {
      content.content = [...header, '(generating summary…)'].join('\n');
    } else {
      content.content = [...header, email.bodyText].join('\n');
    }
  }

  return { root, render };
}
