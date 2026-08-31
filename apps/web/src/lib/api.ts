import {
  actorContextSchema,
  activeShopQrSchema,
  clientHomeSchema,
  commandResponseSchema,
  connectShopResponseSchema,
  correctionResponseSchema,
  operationPreviewSchema,
  publicStatementSchema,
  recordOperationResponseSchema,
  relationshipSchema,
  resolveShopResponseSchema,
  shareLinkResponseSchema,
  shopActivitySchema,
  shopClientSummarySchema,
  shopSummarySchema,
  type ActorContext,
  type ClientHome,
  type Relationship,
} from "@boutikier/contracts";
import { supabase } from "./supabase";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  init: RequestInit = {},
  authenticated = true,
) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (authenticated) {
    if (!supabase) throw new ApiError("Supabase n'est pas configuré.", 503, "supabase_not_configured");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new ApiError("Votre session a expiré.", 401, "authentication_required");
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload as { error?: string; code?: string; details?: unknown } | null;
    throw new ApiError(body?.error || "La requête n'a pas abouti.", response.status, body?.code, body?.details);
  }
  return schema.parse(payload);
}

export const api = {
  me: () => request("/api/me", actorContextSchema),
  onboardShop: (name: string) => request("/api/onboarding/shop", actorContextSchema, {
    method: "POST", body: JSON.stringify({ name }),
  }),
  onboardClient: (displayName: string) => request("/api/onboarding/client", actorContextSchema, {
    method: "POST", body: JSON.stringify({ displayName }),
  }),
  shopSummary: (period: "today" | "7d" | "month" | "all") => request(`/api/shop/summary?period=${period}`, shopSummarySchema),
  shopClients: (query = "") => request(`/api/shop/clients?q=${encodeURIComponent(query)}`, {
    parse: (value: unknown) => {
      const shape = value as { items?: unknown[]; nextCursor?: string | null };
      return {
        items: (shape.items || []).map((item) => shopClientSummarySchema.parse(item)),
        nextCursor: shape.nextCursor ?? null,
      };
    },
  }),
  createShopClient: (input: { name: string; phoneRaw?: string; phoneE164?: string }) => request("/api/shop/clients", shopClientSummarySchema, {
    method: "POST", body: JSON.stringify(input),
  }),
  shopRelationship: (id: string) => request(`/api/shop/clients/${id}`, relationshipSchema),
  shopActivity: () => request("/api/shop/activity", shopActivitySchema),
  shopAccount: () => request("/api/shop/account", actorContextSchema),
  updateShopAccount: (name: string) => request("/api/shop/account", actorContextSchema, {
    method: "PATCH", body: JSON.stringify({ name }),
  }),
  shopQr: () => request("/api/shop/qr", activeShopQrSchema),
  rotateShopQr: () => request("/api/shop/qr", activeShopQrSchema, { method: "POST" }),
  resolveShopQr: (code: string) => request("/api/qr/shops/resolve", resolveShopResponseSchema, {
    method: "POST", body: JSON.stringify({ code }),
  }, false),
  connectShop: (code: string) => request("/api/shop/connect", connectShopResponseSchema, {
    method: "POST", body: JSON.stringify({ code }),
  }),
  clientHome: () => request("/api/client/home", clientHomeSchema),
  clientRelationship: (id: string) => request(`/api/client/relationships/${id}`, relationshipSchema),
  previewOperation: (input: Record<string, unknown>) => request("/api/operations/preview", operationPreviewSchema, {
    method: "POST", body: JSON.stringify(input),
  }),
  recordOperation: (input: Record<string, unknown>) => request("/api/operations", recordOperationResponseSchema, {
    method: "POST", body: JSON.stringify(input),
  }),
  correctEntry: (id: string, input: Record<string, unknown>) => request(`/api/entries/${id}/correction`, correctionResponseSchema, {
    method: "POST", body: JSON.stringify(input),
  }),
  disputeEntry: (id: string, input: Record<string, unknown>) => request(`/api/entries/${id}/disputes`, commandResponseSchema, {
    method: "POST", body: JSON.stringify(input),
  }),
  createShareLink: (id: string) => request(`/api/relationships/${id}/share-links`, shareLinkResponseSchema, {
    method: "POST", body: JSON.stringify({ ttlDays: 30 }),
  }),
  revokeShareLink: (id: string) => request(`/api/share-links/${id}`, { parse: () => null }, { method: "DELETE" }),
  publicStatement: (token: string) => request(`/api/public/statements/${encodeURIComponent(token)}`, publicStatementSchema, {}, false),
};

export type { ActorContext, ClientHome, Relationship };
