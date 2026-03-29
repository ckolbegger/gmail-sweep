import { describe, it, expect, afterEach } from "bun:test";
import { createApp } from "@backend/server";
import { createTestDb } from "@test/helpers/test-db";
import type Database from "bun:sqlite";

describe("GET /status", () => {
  let app: ReturnType<typeof createApp>;
  let cleanup: () => void;
  let db: Database;

  afterEach(() => {
    cleanup?.();
  });

  it("should return 200 with status ok", async () => {
    ({ db, cleanup } = createTestDb());
    app = createApp({ db });
    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("should include the server version", async () => {
    ({ db, cleanup } = createTestDb());
    app = createApp({ db });
    const res = await app.request("/status");
    const body = await res.json();
    expect(body.version).toBeDefined();
  });

  it("should include database status (connected or error)", async () => {
    ({ db, cleanup } = createTestDb());
    app = createApp({ db });
    const res = await app.request("/status");
    const body = await res.json();
    expect(body.database).toBe("connected");
  });
});
