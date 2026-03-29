import type Database from "bun:sqlite";
import { createApp } from "@backend/server";

export function createMockBackend(db: Database, port: number = 0): {
  stop: () => void;
  url: string;
} {
  const app = createApp({ db });
  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });

  return {
    stop: () => server.stop(),
    url: `http://127.0.0.1:${server.port}`,
  };
}
