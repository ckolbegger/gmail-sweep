import { describe, it, expect, mock } from "bun:test";
import { AutoPoller } from "@backend/services/auto-poller";

describe("AutoPoller", () => {
  describe("error handling", () => {
    it("should log sync errors instead of silently swallowing them", async () => {
      const errorSpy = mock(() => {});
      const originalError = console.error;
      console.error = errorSpy;

      const syncError = new Error("Sync exploded");
      const poller = new AutoPoller({
        intervalMs: 30,
        onSync: () => Promise.reject(syncError),
        isAuthorized: () => true,
      });

      poller.start();

      // Wait for at least one poll cycle
      await new Promise((r) => setTimeout(r, 80));
      poller.stop();

      console.error = originalError;

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      // Should log the actual error
      const loggedArgs = errorSpy.mock.calls[0];
      expect(loggedArgs.some((arg: any) =>
        arg instanceof Error && arg.message === "Sync exploded"
      )).toBe(true);
    });

    it("should continue polling after a sync error", async () => {
      let syncCount = 0;
      const poller = new AutoPoller({
        intervalMs: 30,
        onSync: async () => {
          syncCount++;
          if (syncCount === 1) throw new Error("First sync fails");
        },
        isAuthorized: () => true,
      });

      poller.start();
      await new Promise((r) => setTimeout(r, 120));
      poller.stop();

      // Should have polled more than once despite the first failure
      expect(syncCount).toBeGreaterThanOrEqual(2);
    });
  });
});
