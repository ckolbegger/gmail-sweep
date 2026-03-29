export interface AutoPollerConfig {
  intervalMs: number;
  onSync: () => Promise<void>;
  isAuthorized: () => boolean;
}

export class AutoPoller {
  private config: AutoPollerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(config: AutoPollerConfig) {
    this.config = config;
  }

  start(): void {
    if (this.config.intervalMs <= 0) return;

    this.timer = setInterval(async () => {
      if (this.syncing) return;
      if (!this.config.isAuthorized()) return;

      this.syncing = true;
      try {
        await this.config.onSync();
      } catch {
        // Silently handle sync errors in auto-poller
      } finally {
        this.syncing = false;
      }
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
