import { Hono } from "hono";
import type { OAuthClient } from "@backend/auth/oauth";
import type { TokenStore } from "@backend/auth/token-store";

export function createAuthRouter(
  oauth: OAuthClient | null,
  tokenStore: TokenStore
) {
  const router = new Hono();

  router.get("/auth/url", (c) => {
    if (!oauth) {
      return c.json({ error: "Credentials not configured" }, 503);
    }
    const url = oauth.getAuthorizationUrl();
    return c.json({ url });
  });

  router.get("/auth/callback", async (c) => {
    if (!oauth) {
      return c.json({ error: "Credentials not configured" }, 503);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }

    try {
      await oauth.exchangeCode(code, state ?? "");
      return c.json({ status: "ok", message: "Authorization successful" });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  router.get("/auth/status", (c) => {
    const tokens = tokenStore.load();
    const authorized = tokens !== null;
    return c.json({ authorized });
  });

  return router;
}
