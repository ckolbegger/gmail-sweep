import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  getAccountDbPath,
  getAccountsPath,
  getAppHome,
  getConfigPath,
} from "../../packages/backend/src/config/paths";

describe("app config paths", () => {
  test("it should use GMAIL_SWEEP_HOME when provided", () => {
    expect(getAppHome({ GMAIL_SWEEP_HOME: "/tmp/custom-home", HOME: "/tmp/user-home" })).toBe(
      "/tmp/custom-home",
    );
  });

  test("it should default to ~/.gmail-sweep when no override exists", () => {
    expect(getAppHome({ HOME: "/tmp/user-home" })).toBe(join("/tmp/user-home", ".gmail-sweep"));
  });

  test("it should place account databases under accounts/<account-id>/mail.sqlite", () => {
    const home = "/tmp/gmail-sweep";

    expect(getConfigPath(home)).toBe(join(home, "config.json"));
    expect(getAccountsPath(home)).toBe(join(home, "accounts"));
    expect(getAccountDbPath(home, "account-1")).toBe(
      join(home, "accounts", "account-1", "mail.sqlite"),
    );
  });
});
