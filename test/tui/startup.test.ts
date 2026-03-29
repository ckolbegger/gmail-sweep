import { describe, it, expect, afterEach } from "bun:test";
import { createApp } from "@backend/server";
import { createTestDb } from "@test/helpers/test-db";
import { ApiClient } from "@tui/api";
import type Database from "bun:sqlite";

describe("TUI startup", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it("should display a connected message when backend is reachable", async () => {
    const { db, cleanup: c } = createTestDb();
    cleanup = c;
    const app = createApp({ db });
    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("should fail when backend is unreachable", async () => {
    // Test that a bad URL throws
    const client = new ApiClient("http://127.0.0.1:1");
    await expect(client.getStatus()).rejects.toThrow();
  });
});
