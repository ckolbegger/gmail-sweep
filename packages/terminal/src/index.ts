import { createCliRenderer } from '@opentui/core';
import { createApiClient } from './api.js';
import {
  createAppState, setEmails, nextEmail, prevEmail, selectEmail, togglePreview,
  archiveEmail, deleteEmail, backToInbox, startSearch, setSearchResults,
  setStatus, setLoading, updateOpenEmail, setSummarizerStatus, toggleDetailFullWidth,
} from './app.js';
import type { AppState } from './app.js';
import { buildInboxView } from './views/inbox.js';
import { buildEmailView } from './views/email.js';
import { buildSearchView } from './views/search.js';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:3141';
const api = createApiClient(BACKEND_URL);

const renderer = await createCliRenderer({ exitOnCtrlC: false });
renderer.setTerminalTitle('gmail-sweep');
renderer.root.flexDirection = 'column';
renderer.root.width = '100%';
renderer.root.height = '100%';

let state: AppState = createAppState();

const inboxView = buildInboxView(renderer);
const emailView = buildEmailView(renderer);
const searchView = buildSearchView(renderer, triggerSearch);

let activeRoot: any = null;
function showView(viewRoot: any): void {
  if (activeRoot) renderer.root.remove(activeRoot.id);
  activeRoot = viewRoot;
  renderer.root.add(activeRoot);
}

function render(): void {
  if (state.view === 'inbox') {
    showView(inboxView.root);
    inboxView.render(state);
  } else if (state.view === 'email') {
    showView(emailView.root);
    emailView.render(state);
  } else {
    showView(searchView.root);
    searchView.render(state);
  }
  renderer.requestRender();
}

async function loadEmails(): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, 'Loading…');
  render();
  try {
    const { emails } = await api.listEmails({ limit: 200 });
    state = setEmails(state, emails);
    state = setStatus(state, `${emails.length} emails`);
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}

async function loadEmailsAnchored(): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, 'Loading from unsummarized…');
  render();
  try {
    const { emails } = await api.listEmails({ anchor_unsummarized: true, limit: 200 });
    state = setEmails(state, emails);
    state = setStatus(state, `${emails.length} emails (anchored at unsummarized)`);
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}

async function triggerSync(): Promise<void> {
  state = setStatus(state, 'Syncing…');
  render();
  try {
    const result = await api.sync(syncBatchSize);
    state = setStatus(state, `Sync done — ${result.newEmails} new`);
    await loadEmails();
  } catch (err) {
    state = setStatus(state, `Sync error: ${(err as Error).message}`);
    render();
  }
}

async function triggerArchive(id: string): Promise<void> {
  try {
    await api.archiveEmail(id);
    state = archiveEmail(state, id);
    if (state.view === 'email') state = backToInbox(state);
    state = setStatus(state, 'Archived');
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  render();
}

async function triggerDelete(id: string): Promise<void> {
  try {
    await api.deleteEmail(id);
    state = deleteEmail(state, id);
    if (state.view === 'email') state = backToInbox(state);
    state = setStatus(state, 'Deleted');
  } catch (err) {
    state = setStatus(state, `Error: ${(err as Error).message}`);
  }
  render();
}

async function triggerSearch(query: string): Promise<void> {
  state = setLoading(state, true);
  state = setStatus(state, `Searching: "${query}"…`);
  render();
  try {
    const { emails, scores } = await api.search(query);
    state = setSearchResults(state, emails, scores);
    state = setStatus(state, `${emails.length} results for "${query}"`);
  } catch (err) {
    state = setStatus(state, `Search error: ${(err as Error).message}`);
  }
  state = setLoading(state, false);
  render();
}

async function triggerOpenEmail(index: number): Promise<void> {
  state = selectEmail(state, index);
  render();
  const email = state.openEmail;
  if (!email || email.summary) return;
  state = setStatus(state, 'Generating summary…');
  render();
  try {
    const summary = await api.getSummary(email.id);
    state = updateOpenEmail(state, { ...email, summary });
    state = setStatus(state, '');
  } catch {
    state = setStatus(state, 'Summary failed — Tab for full text');
  }
  render();
}

renderer.addInputHandler((seq: string): boolean => {
  const up = seq === '\x1b[A' || seq === 'k';
  const down = seq === '\x1b[B' || seq === 'j';

  switch (state.view) {
    case 'inbox':
      if (up) { state = prevEmail(state); render(); return true; }
      if (down) { state = nextEmail(state); render(); return true; }
      if (seq === '\r') { triggerOpenEmail(state.selectedIndex); return true; }
      if (seq === '\t') { state = togglePreview(state); render(); return true; }
      if (seq === 'e') { const e = state.emails[state.selectedIndex]; if (e) triggerArchive(e.id); return true; }
      if (seq === '#') { const e = state.emails[state.selectedIndex]; if (e) triggerDelete(e.id); return true; }
      if (seq === '/') { state = startSearch(state); searchView.focusInput(); render(); return true; }
      if (seq === 'r') { triggerSync(); return true; }
      if (seq === 'l' || seq === 'L') { loadEmailsAnchored(); return true; }
      if (seq === 'q') { renderer.destroy(); process.exit(0); }
      break;

    case 'email':
      if (seq === '\x1b') { state = backToInbox(state); render(); return true; }
      if (seq === '\t') { state = togglePreview(state); render(); return true; }
      if (seq === 'f') { state = toggleDetailFullWidth(state); render(); return true; }
      if (seq === 'e' && state.openEmail) { triggerArchive(state.openEmail.id); return true; }
      if (seq === '#' && state.openEmail) { triggerDelete(state.openEmail.id); return true; }
      if (seq === 'q') { renderer.destroy(); process.exit(0); }
      break;

    case 'search':
      if (seq === '\x1b') { state = backToInbox(state); render(); return true; }
      break;
  }
  return false;
});

let lastProcessedCount = 0;

async function pollSummarizerStatus(): Promise<void> {
  try {
    const status = await api.getSummarizerStatus();
    state = setSummarizerStatus(state, status);
    render();
    if (status.processed > lastProcessedCount) {
      lastProcessedCount = status.processed;
      await loadEmails();
    }
  } catch {
    // backend may not be ready yet — ignore
  }
}

const config = await api.getConfig().catch(() => null);
const pollIntervalMs = config?.terminal?.summarizerPollIntervalMs ?? 30_000;
const syncBatchSize = config?.sync?.defaultBatchSize ?? 500;

process.on('SIGWINCH', () => render());

await loadEmails();
await pollSummarizerStatus();
setInterval(pollSummarizerStatus, pollIntervalMs);
render();
