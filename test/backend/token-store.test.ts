import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TokenStore } from "@backend/auth/token-store";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE_DIR = join(tmpdir(), "gmail-sweep-token-test");

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("TokenStore", () => {
  describe("save", () => {
    it("should persist access_token, refresh_token, and expiry to a JSON file", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "token.json"));
      store.save({
        access_token: "at-123",
        refresh_token: "rt-456",
        expiry_date: Date.now() + 3600000,
      });
      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.access_token).toBe("at-123");
      expect(loaded!.refresh_token).toBe("rt-456");
    });

    it("should create the directory if it does not exist", () => {
      const nestedDir = join(FIXTURE_DIR, "nested", "deep");
      const store = new TokenStore(join(nestedDir, "token.json"));
      store.save({
        access_token: "at",
        refresh_token: "rt",
        expiry_date: Date.now(),
      });
      const loaded = store.load();
      expect(loaded).not.toBeNull();
    });
  });

  describe("load", () => {
    it("should load tokens from the JSON file", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "token.json"));
      store.save({
        access_token: "at",
        refresh_token: "rt",
        expiry_date: 1000,
      });
      const loaded = store.load();
      expect(loaded!.access_token).toBe("at");
    });

    it("should return null if the file does not exist", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "nonexistent.json"));
      expect(store.load()).toBeNull();
    });

    it("should throw with a clear message if the file is malformed JSON", () => {
      const { writeFileSync } = require("node:fs");
      writeFileSync(join(FIXTURE_DIR, "bad.json"), "not json{{{");
      const store = new TokenStore(join(FIXTURE_DIR, "bad.json"));
      expect(() => store.load()).toThrow(/malformed/i);
    });
  });

  describe("isExpired", () => {
    it("should return true if expiry time has passed", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "token.json"));
      store.save({
        access_token: "at",
        refresh_token: "rt",
        expiry_date: Date.now() - 1000,
      });
      expect(store.isExpired()).toBe(true);
    });

    it("should return false if expiry time has not passed", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "token.json"));
      store.save({
        access_token: "at",
        refresh_token: "rt",
        expiry_date: Date.now() + 3600000,
      });
      expect(store.isExpired()).toBe(false);
    });

    it("should return true if no tokens are loaded", () => {
      const store = new TokenStore(join(FIXTURE_DIR, "nonexistent.json"));
      expect(store.isExpired()).toBe(true);
    });
  });
});
