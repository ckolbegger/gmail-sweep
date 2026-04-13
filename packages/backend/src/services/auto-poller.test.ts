import { describe, it, expect, vi } from 'vitest';
import { createAutoPoller } from './auto-poller.js';

describe('auto-poller', () => {
  it('skips when not authorized', async () => {
    vi.useFakeTimers();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const poller = createAutoPoller({ intervalMs: 1000, isAuthorized: () => false, onSync });
    poller.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onSync).not.toHaveBeenCalled();
    poller.stop();
    vi.useRealTimers();
  });

  it('invokes onSync on interval and prevents re-entry', async () => {
    vi.useFakeTimers();
    let resolveSync: () => void;
    const onSync = vi.fn().mockImplementation(() => new Promise<void>(r => { resolveSync = r; }));
    const poller = createAutoPoller({ intervalMs: 1000, isAuthorized: () => true, onSync });
    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(1); // still running
    resolveSync!();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSync).toHaveBeenCalledTimes(2);
    poller.stop();
    vi.useRealTimers();
  });
});
