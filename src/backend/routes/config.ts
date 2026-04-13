import { Hono } from "hono";
import { loadConfig, saveConfig } from "../config";

const IMMUTABLE_KEYS = [
  "embedding.dimension",
  "embedding.provider",
  "embedding.model",
  "server.host",
  "server.port",
];

function deepMerge<T>(base: T, patch: any): T {
  if (typeof base !== "object" || base === null) return patch ?? base;
  if (typeof patch !== "object" || patch === null) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge((base as any)[k], patch[k]);
  }
  return out as T;
}

function touchedImmutableKeys(patch: any, prefix = ""): string[] {
  const result: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      result.push(...touchedImmutableKeys(v, path));
    } else {
      if (IMMUTABLE_KEYS.includes(path)) result.push(path);
    }
  }
  return result;
}

export function createConfigRouter(configPath: string) {
  const router = new Hono();

  router.get("/config", (c) => {
    return c.json(loadConfig(configPath));
  });

  router.post("/config", async (c) => {
    let patch: any;
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const current = loadConfig(configPath);
    const merged = deepMerge(current, patch);
    saveConfig(configPath, merged);
    const touched = touchedImmutableKeys(patch);
    return c.json({
      ...merged,
      restart_required: touched.length > 0,
      restart_required_keys: touched,
    });
  });

  return router;
}
