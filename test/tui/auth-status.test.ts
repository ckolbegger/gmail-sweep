import { describe, it, expect, afterEach } from "bun:test";
import { createApp } from "@backend/server";
import { createTestDb } from "@test/helpers/test-db";
import { TokenStore } from "@backend/auth/token-store";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";

describe("TUI auth status", () => {
  let cleanup: () => void;
  let tokenDir: string;

  afterEach(() => {
    cleanup?.();
    if (tokenDir) rmSync(tokenDir, { recursive: true, force: true });
  });

  it("should display authorization instructions when not authorized", async () => {
    const { db, cleanup: c } = createTestDb();
    cleanup = c;
    tokenDir = join(tmpdir(), `gs-auth-test-${Date.now()}`);
    mkdirSync(tokenDir, { recursive: true });
    const tokenStore = new TokenStore(join(tokenDir, "token.json"));
    const app = createApp({ db, tokenStore });
    const res = await app.request("/auth/status");
    const body = await res.json();
    expect(body.authorized).toBe(false);
  });

  it("should display authorized status when tokens exist", async () => {
    const { db, cleanup: c } = createTestDb();
    cleanup = c;
    tokenDir = join(tmpdir(), `gs-auth-test2-${Date.now()}`);
    mkdirSync(tokenDir, { recursive: true });
    const tokenStore = new TokenStore(join(tokenDir, "token.json"));
    tokenStore.save({
      access_token: "at",
      refresh_token: "rt",
      expiry_date: Date.now() + 3600000,
    });
    const app = createApp({ db, tokenStore });
    const res = await app.request("/auth/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorized).toBe(true);
  });
});
