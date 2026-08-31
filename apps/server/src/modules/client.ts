import {
  actorContextSchema,
  clientHomeSchema,
  relationshipSchema,
} from "@boutikier/contracts";
import type { Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize } from "../http.js";
import { callUserRpc, requireBearerToken } from "../supabase.js";

type ApiApp = Hono<{ Bindings: Bindings }>;

export function registerClientRoutes(app: ApiApp) {
  app.get("/api/client/home", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(context.env, token, "get_client_home", {});
    return context.json(clientHomeSchema.parse(camelize(result)));
  });

  app.get("/api/client/relationships/:id", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "get_shop_client",
      { p_shop_client_id: context.req.param("id") },
    );
    return context.json(relationshipSchema.parse(camelize(result)));
  });

  app.get("/api/client/account", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)));
  });
}
