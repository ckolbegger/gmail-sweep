export interface AutoPollerOptions {
  intervalMs: number;
  isAuthorized: () => boolean | Promise<boolean>;
  onSync: () => Promise<void>;
  logger?: { error: (msg: string, err?: unknown) => void };
}

export interface AutoPoller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createAutoPoller(opts: AutoPollerOptions): AutoPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let syncing = false;

  return {
    start() {
      if (opts.intervalMs <= 0 || timer) return;
      timer = setInterval(async () => {
        if (syncing) return;
        if (!(await opts.isAuthorized())) return;
        syncing = true;
        try { await opts.onSync(); }
        catch (err) { opts.logger?.error('[auto-poller] sync failed', err); }
        finally { syncing = false; }
      }, opts.intervalMs);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    isRunning() { return timer !== null; },
  };
}
