import {
  publicStatementSchema,
  shareLinkRequestSchema,
  shareLinkResponseSchema,
  uuidSchema,
} from "@boutikier/contracts";
import type { Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize, firstRow, readJson, requireSecret } from "../http.js";
import { createShareToken, verifyShareToken } from "../shop-codes.js";
import { callServiceRpc, callUserRpc, requireBearerToken } from "../supabase.js";

type ApiApp = Hono<{ Bindings: Bindings }>;

export function registerSharingRoutes(app: ApiApp) {
  app.post("/api/relationships/:id/share-links", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = shareLinkRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<unknown>(
      context.env,
      token,
      "create_share_link",
      {
        p_shop_client_id: uuidSchema.parse(context.req.param("id")),
        p_ttl: `${request.ttlDays} days`,
      },
    );
    const row = firstRow(result) as { share_link_id: string; valid_until: string } | undefined;
    if (!row) throw new Error("share_link_not_created");
    const secret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
    const shareToken = await createShareToken(row.share_link_id, row.valid_until, secret);
    const origin = context.env.APP_ORIGIN || new URL(context.req.url).origin;
    return context.json(shareLinkResponseSchema.parse({
      shareLinkId: row.share_link_id,
      validUntil: row.valid_until,
      token: shareToken,
      url: `${origin}/s/${shareToken}`,
    }), 201);
  });

  app.delete("/api/share-links/:id", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const shareLinkId = uuidSchema.parse(context.req.param("id"));
    await callUserRpc(context.env, token, "revoke_share_link", {
      p_share_link_id: shareLinkId,
    });
    return context.body(null, 204);
  });

  app.get("/api/public/statements/:token", async (context) => {
    const shareToken = context.req.param("token");
    const secret = requireSecret(context.env.APP_HMAC_SECRET, "app_hmac_secret");
    const parsed = await verifyShareToken(shareToken, secret);
    if (!parsed) return context.json({ error: "share_link_invalid" }, 404);
    requireSecret(context.env.SUPABASE_SECRET_KEY, "supabase_service");
    const result = await callServiceRpc<Record<string, unknown>>(
      context.env,
      "read_shared_ledger",
      { p_share_link_id: parsed.shareLinkId },
    );
    const statement = publicStatementSchema.parse({
      ...(camelize(result) as Record<string, unknown>),
      validUntil: parsed.expiresAt,
    });
    context.header("Cache-Control", "private, no-store");
    return context.json(statement);
  });
}
