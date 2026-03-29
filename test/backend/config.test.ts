import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "@backend/config";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE_DIR = join(tmpdir(), "gmail-sweep-config-test");

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function writeConfig(content: string) {
  writeFileSync(join(FIXTURE_DIR, "config.toml"), content);
}

describe("Config loader", () => {
  it("should load config from a TOML file", () => {
    writeConfig(`
[server]
port = 8080

[auth]
credentials_path = "/path/to/creds.json"
token_path = "/path/to/token.json"

[sync]
batch_size = 50

[llm]
provider = "openai"
api_key = "sk-test"
model = "gpt-4o-mini"
base_url = "https://api.openai.com"
`);
    const config = loadConfig(join(FIXTURE_DIR, "config.toml"));
    expect(config.server.port).toBe(8080);
    expect(config.auth.credentials_path).toBe("/path/to/creds.json");
    expect(config.sync.batch_size).toBe(50);
    expect(config.llm.provider).toBe("openai");
  });

  it("should apply default values for missing optional fields", () => {
    writeConfig(`
[server]
port = 3000

[auth]
credentials_path = "/creds.json"
token_path = "/token.json"
`);
    const config = loadConfig(join(FIXTURE_DIR, "config.toml"));
    expect(config.sync.batch_size).toBe(100);
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o-mini");
    expect(config.llm.base_url).toBe("https://api.openai.com/v1");
    expect(config.server.host).toBe("127.0.0.1");
  });

  it("should throw with a clear message if required fields are missing", () => {
    writeConfig(`[server]\nport = 3000\n`);
    expect(() => loadConfig(join(FIXTURE_DIR, "config.toml"))).toThrow(
      /credentials_path/
    );
  });

  it("should expand ~ in file paths to the home directory", () => {
    writeConfig(`
[server]
port = 3000

[auth]
credentials_path = "~/creds.json"
token_path = "~/token.json"
`);
    const config = loadConfig(join(FIXTURE_DIR, "config.toml"));
    expect(config.auth.credentials_path).not.toContain("~");
    expect(config.auth.credentials_path).toContain("creds.json");
  });

  it("should validate server port is a number between 1 and 65535", () => {
    writeConfig(`
[server]
port = 0

[auth]
credentials_path = "/c.json"
token_path = "/t.json"
`);
    expect(() => loadConfig(join(FIXTURE_DIR, "config.toml"))).toThrow(
      /port/
    );
  });

  it("should validate sync.batch_size is a positive integer", () => {
    writeConfig(`
[server]
port = 3000

[auth]
credentials_path = "/c.json"
token_path = "/t.json"

[sync]
batch_size = -1
`);
    expect(() => loadConfig(join(FIXTURE_DIR, "config.toml"))).toThrow(
      /batch_size/
    );
  });
});
