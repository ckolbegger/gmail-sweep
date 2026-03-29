import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { AutoPoller } from "@backend/services/auto-poller";

describe("Auto-polling", () => {
  it("should trigger sync at the configured poll interval", async () => {
    let syncCount = 0;
    const poller = new AutoPoller({
      intervalMs: 100,
      onSync: async () => { syncCount++; },
      isAuthorized: () => true,
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 250));
    poller.stop();
    expect(syncCount).toBeGreaterThanOrEqual(2);
  });

  it("should not trigger overlapping syncs", async () => {
    let running = false;
    let overlapDetected = false;
    const poller = new AutoPoller({
      intervalMs: 50,
      onSync: async () => {
        if (running) overlapDetected = true;
        running = true;
        await new Promise((r) => setTimeout(r, 100));
        running = false;
      },
      isAuthorized: () => true,
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 300));
    poller.stop();
    expect(overlapDetected).toBe(false);
  });

  it("should not trigger sync when not authorized", async () => {
    let syncCount = 0;
    const poller = new AutoPoller({
      intervalMs: 100,
      onSync: async () => { syncCount++; },
      isAuthorized: () => false,
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 250));
    poller.stop();
    expect(syncCount).toBe(0);
  });

  it("should be disabled when poll_interval_seconds is 0", async () => {
    let syncCount = 0;
    const poller = new AutoPoller({
      intervalMs: 0,
      onSync: async () => { syncCount++; },
      isAuthorized: () => true,
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 200));
    poller.stop();
    expect(syncCount).toBe(0);
  });
});
