import {
  actorContextSchema,
  onboardingClientRequestSchema,
  onboardingShopRequestSchema,
} from "@boutikier/contracts";
import type { Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize, readJson, requireSecret } from "../http.js";
import { createShopCode, hashShopCode } from "../shop-codes.js";
import { callUserRpc, requireBearerToken } from "../supabase.js";

type ApiApp = Hono<{ Bindings: Bindings }>;

export function registerAuthRoutes(app: ApiApp) {
  app.get("/api/me", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)));
  });

  app.post("/api/onboarding/shop", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = onboardingShopRequestSchema.parse(await readJson(context));
    const secret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
    const codeId = crypto.randomUUID();
    const code = await createShopCode(codeId, secret);
    await callUserRpc(context.env, token, "complete_shop_onboarding_with_code", {
      p_name: request.name,
      p_code_id: codeId,
      p_code_hash: await hashShopCode(code),
      p_code_prefix: codeId.replaceAll("-", "").slice(0, 8),
    });
    const result = await callUserRpc(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)), 201);
  });

  app.post("/api/onboarding/client", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = onboardingClientRequestSchema.parse(await readJson(context));
    await callUserRpc(context.env, token, "complete_client_onboarding", {
      p_display_name: request.displayName,
    });
    const result = await callUserRpc(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)), 201);
  });
}
