import {
  activeShopQrSchema,
  connectShopRequestSchema,
  connectShopResponseSchema,
  createShopClientRequestSchema,
  actorContextSchema,
  resolveShopRequestSchema,
  resolveShopResponseSchema,
  shopActivitySchema,
  shopClientSummarySchema,
  shopSummaryPeriodSchema,
  shopSummarySchema,
  relationshipSchema,
  updateShopAccountRequestSchema,
} from "@boutikier/contracts";
import type { Context, Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize, readJson, requireSecret } from "../http.js";
import { createShopCode, hashShopCode, verifyShopCode } from "../shop-codes.js";
import { callServiceRpc, callUserRpc, requireBearerToken } from "../supabase.js";

type ApiApp = Hono<{ Bindings: Bindings }>;

async function activeQr(context: Context<{ Bindings: Bindings }>, token: string) {
  const raw = await callUserRpc<Record<string, unknown> | null>(context.env, token, "get_active_shop_code", {});
  if (!raw) return null;
  const value = camelize(raw) as { codeId: string; codePrefix: string; createdAt: string; revokedAt: string | null };
  const secret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
  const code = await createShopCode(value.codeId, secret);
  return activeShopQrSchema.parse({
    codeId: value.codeId,
    code,
    path: `/q/s/${code}`,
    createdAt: value.createdAt,
    revokedAt: value.revokedAt,
  });
}

export function registerShopRoutes(app: ApiApp) {
  app.get("/api/shop/summary", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const period = shopSummaryPeriodSchema.parse(context.req.query("period") ?? "today");
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "get_shop_summary",
      { p_period: period },
    );
    return context.json(shopSummarySchema.parse(camelize(result)));
  });

  app.get("/api/shop/clients", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "list_shop_clients",
      {
        p_query: context.req.query("q") ?? "",
        p_limit: Number(context.req.query("limit") ?? 100),
      },
    );
    const value = camelize(result);
    return context.json(value);
  });

  app.post("/api/shop/clients", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = createShopClientRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "create_shop_client",
      {
        p_name: request.name,
        p_phone_raw: request.phoneRaw ?? null,
        p_phone_e164: request.phoneE164 ?? null,
      },
    );
    return context.json(shopClientSummarySchema.parse(camelize(result)), 201);
  });

  app.get("/api/shop/clients/:id", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "get_shop_client",
      { p_shop_client_id: context.req.param("id") },
    );
    return context.json(relationshipSchema.parse(camelize(result)));
  });

  app.get("/api/shop/activity", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "get_shop_activity",
      { p_limit: Number(context.req.query("limit") ?? 50) },
    );
    return context.json(shopActivitySchema.parse(camelize(result)));
  });

  app.get("/api/shop/account", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await callUserRpc<Record<string, unknown>>(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)));
  });

  app.patch("/api/shop/account", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = updateShopAccountRequestSchema.parse(await readJson(context));
    await callUserRpc(context.env, token, "update_shop_profile", { p_name: request.name });
    const result = await callUserRpc<Record<string, unknown>>(context.env, token, "get_actor_context", {});
    return context.json(actorContextSchema.parse(camelize(result)));
  });

  app.get("/api/shop/qr", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const result = await activeQr(context, token);
    if (!result) return context.json({ error: "shop_qr_missing" }, 404);
    return context.json(result);
  });

  app.post("/api/shop/qr", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const secret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
    const codeId = crypto.randomUUID();
    const code = await createShopCode(codeId, secret);
    const codeHash = await hashShopCode(code);
    await callUserRpc(context.env, token, "rotate_shop_public_code_with_id", {
      p_code_id: codeId,
      p_code_hash: codeHash,
      p_code_prefix: codeId.replaceAll("-", "").slice(0, 8),
    });
    const result = await activeQr(context, token);
    if (!result) return context.json({ error: "shop_qr_missing" }, 503);
    return context.json(result, 201);
  });

  app.post("/api/qr/shops/resolve", async (context) => {
    const request = resolveShopRequestSchema.parse(await readJson(context));
    const hmacSecret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
    if (!await verifyShopCode(request.code, hmacSecret)) {
      return context.json({ error: "shop_code_invalid" }, 404);
    }
    requireSecret(context.env.SUPABASE_SECRET_KEY, "supabase_service");
    const result = await callServiceRpc<Record<string, unknown>>(
      context.env,
      "resolve_shop_code",
      { p_code_hash: await hashShopCode(request.code) },
    );
    return context.json(resolveShopResponseSchema.parse(camelize(result)));
  });

  app.post("/api/shop/connect", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = connectShopRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "connect_to_shop",
      { p_code_hash: await hashShopCode(request.code) },
    );
    return context.json(connectShopResponseSchema.parse(camelize(result)));
  });
}
