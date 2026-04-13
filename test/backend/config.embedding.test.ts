import { describe, test, expect } from "bun:test";
import { loadConfig, saveConfig } from "../../src/backend/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config embedding section", () => {
  test("parses embedding section with local provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-"));
    const p = join(dir, "config.toml");
    writeFileSync(p, `
[auth]
credentials_path = "/tmp/c"
token_path = "/tmp/t"
[embedding]
provider = "local"
model = "BAAI/bge-m3"
dimension = 1024
[content_extraction]
active_strategy = "default"
[content_extraction.strategies.default]
type = "template"
template = "Subject: {{subject}}\\n\\n{{body_text}}"
`);
    const cfg = loadConfig(p);
    expect(cfg.embedding.provider).toBe("local");
    expect(cfg.embedding.dimension).toBe(1024);
    expect(cfg.content_extraction.strategies.default.template).toContain("{{subject}}");
  });

  test("uses defaults when embedding and content_extraction sections absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-"));
    const p = join(dir, "config.toml");
    writeFileSync(p, `
[auth]
credentials_path = "/tmp/c"
token_path = "/tmp/t"
`);
    const cfg = loadConfig(p);
    expect(cfg.embedding.provider).toBe("local");
    expect(cfg.embedding.model).toBe("BAAI/bge-m3");
    expect(cfg.embedding.dimension).toBe(1024);
    expect(cfg.content_extraction.active_strategy).toBe("default");
    expect(cfg.content_extraction.strategies.default.template).toContain("{{subject}}");
  });

  test("saveConfig → loadConfig round-trip preserves values", () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-"));
    const p = join(dir, "config.toml");
    writeFileSync(p, `
[auth]
credentials_path = "/tmp/c"
token_path = "/tmp/t"
[llm]
provider = "openai"
api_key = "sk-test"
model = "gpt-4o-mini"
base_url = "https://api.openai.com/v1"
[embedding]
provider = "openai-compatible"
model = "text-embedding-3-small"
dimension = 1536
api_key = "emb-key"
base_url = "http://localhost:8080/v1"
[content_extraction]
active_strategy = "custom"
[content_extraction.strategies.custom]
type = "template"
template = "{{subject}} — {{body_text}}"
`);
    const original = loadConfig(p);
    saveConfig(p, original);
    const reloaded = loadConfig(p);

    expect(reloaded.llm.api_key).toBe("sk-test");
    expect(reloaded.embedding.provider).toBe("openai-compatible");
    expect(reloaded.embedding.dimension).toBe(1536);
    expect(reloaded.embedding.api_key).toBe("emb-key");
    expect(reloaded.embedding.base_url).toBe("http://localhost:8080/v1");
    expect(reloaded.content_extraction.active_strategy).toBe("custom");
    expect(reloaded.content_extraction.strategies.custom.template).toBe("{{subject}} — {{body_text}}");
  });
});
