import {
  actorContextSchema,
  onboardingClientRequestSchema,
  onboardingShopRequestSchema,
} from "@boutikier/contracts";
import type { Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize, readJson } from "../http.js";
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
    await callUserRpc(context.env, token, "complete_shop_onboarding", {
      p_name: request.name,
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
