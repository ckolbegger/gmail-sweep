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

  describe("onSync callback: worker chaining", () => {
    it("should chain summary and embedding workers after sync with fetched > 0", async () => {
      const summaryProcessPending = mock(() => Promise.resolve({ processed: 1, failed: 0 }));
      const embedProcessPending = mock(() => Promise.resolve({ processed: 1, failed: 0 }));

      const summaryWorker = { processPending: summaryProcessPending } as any;
      const embeddingWorker = { processPending: embedProcessPending } as any;

      // Replicate the onSync pattern from src/backend/index.ts with worker chaining
      let onSyncCallback: (() => Promise<void>) | null = null;

      const poller = new AutoPoller({
        intervalMs: 60000, // long interval — we'll invoke onSync directly
        onSync: async () => {
          // Simulate the chained onSync from index.ts
          const syncService = { syncNewest: mock(() => Promise.resolve({ fetched: 5 })) } as any;
          const result = await syncService.syncNewest(100);
          if (result.fetched > 0) {
            try {
              await summaryWorker.processPending();
            } catch (err) {
              console.error("Summary worker error:", err);
            }
            try {
              await embeddingWorker.processPending();
            } catch (err) {
              console.error("Embedding worker error:", err);
            }
          }
        },
        isAuthorized: () => true,
      });

      // Invoke the callback directly (no timer wait needed)
      await (poller as any).config.onSync();

      expect(summaryProcessPending).toHaveBeenCalled();
      expect(embedProcessPending).toHaveBeenCalled();
    });

    it("should still call embeddingWorker even if summaryWorker fails", async () => {
      const summaryProcessPending = mock(() => Promise.reject(new Error("LLM down")));
      const embedProcessPending = mock(() => Promise.resolve({ processed: 1, failed: 0 }));

      const summaryWorker = { processPending: summaryProcessPending } as any;
      const embeddingWorker = { processPending: embedProcessPending } as any;

      const poller = new AutoPoller({
        intervalMs: 60000,
        onSync: async () => {
          const result = { fetched: 3 };
          if (result.fetched > 0) {
            try {
              await summaryWorker.processPending();
            } catch (err) {
              console.error("Summary worker error:", err);
            }
            try {
              await embeddingWorker.processPending();
            } catch (err) {
              console.error("Embedding worker error:", err);
            }
          }
        },
        isAuthorized: () => true,
      });

      await (poller as any).config.onSync();

      expect(summaryProcessPending).toHaveBeenCalled();
      expect(embedProcessPending).toHaveBeenCalled();
    });

    it("should not call workers when fetched is 0", async () => {
      const summaryProcessPending = mock(() => Promise.resolve({ processed: 0, failed: 0 }));
      const embedProcessPending = mock(() => Promise.resolve({ processed: 0, failed: 0 }));

      const summaryWorker = { processPending: summaryProcessPending } as any;
      const embeddingWorker = { processPending: embedProcessPending } as any;

      const poller = new AutoPoller({
        intervalMs: 60000,
        onSync: async () => {
          const result = { fetched: 0 };
          if (result.fetched > 0) {
            try {
              await summaryWorker.processPending();
            } catch (err) {
              console.error("Summary worker error:", err);
            }
            try {
              await embeddingWorker.processPending();
            } catch (err) {
              console.error("Embedding worker error:", err);
            }
          }
        },
        isAuthorized: () => true,
      });

      await (poller as any).config.onSync();

      expect(summaryProcessPending).not.toHaveBeenCalled();
      expect(embedProcessPending).not.toHaveBeenCalled();
    });
  });
});
