import { describe, test, expect } from "bun:test";
import { createConfigRouter } from "../../../src/backend/routes/config";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-"));
  const p = join(dir, "config.toml");
  writeFileSync(p, `
[auth]
credentials_path="/tmp/c"
token_path="/tmp/t"
[llm]
provider="openai"
api_key="old"
model="gpt-4o-mini"
base_url="https://api.openai.com/v1"
`);
  const app = new Hono().route("/", createConfigRouter(p));
  return { app, p };
}

describe("config routes", () => {
  test("GET /config returns current", async () => {
    const { app } = setup();
    const r = await app.request("/config");
    const body = await r.json();
    expect(body.llm.api_key).toBe("old");
  });

  test("POST /config merges + persists llm.api_key", async () => {
    const { app, p } = setup();
    const r = await app.request("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { api_key: "new" } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.llm.api_key).toBe("new");
    expect(readFileSync(p, "utf8")).toContain("new");
  });

  test("POST /config returns restart_required for immutable keys", async () => {
    const { app, p } = setup();
    const r = await app.request("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedding: { dimension: 768 } }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.restart_required).toBe(true);
    // File is persisted even for immutable keys (takes effect on restart)
    expect(readFileSync(p, "utf8")).toContain("768");
  });

  test("POST /config returns 400 on malformed JSON", async () => {
    const { app } = setup();
    const r = await app.request("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/invalid json/i);
  });
});
