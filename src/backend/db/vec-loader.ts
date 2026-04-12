import type Database from "bun:sqlite";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

function resolveExtensionPath(): string {
  const mod = req("sqlite-vec") as { getLoadablePath?: () => string };
  if (typeof mod.getLoadablePath !== "function") {
    throw new Error("sqlite-vec: getLoadablePath() not available; update sqlite-vec package");
  }
  return mod.getLoadablePath();
}

export function loadVecExtension(db: Database): void {
  const path = resolveExtensionPath();
  (db as any).loadExtension(path);
}
