import type { Bindings } from "./env.js";

interface SupabaseErrorBody {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
}

export class SupabaseRpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SupabaseRpcError";
  }
}

export function requireBearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new SupabaseRpcError("authentication_required", 401);
  }
  return match[1];
}

export async function callUserRpc<T>(
  env: Bindings,
  bearerToken: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new SupabaseRpcError("supabase_not_configured", 503);
  }

  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as SupabaseErrorBody;
    throw new SupabaseRpcError(
      error.message ?? "supabase_rpc_failed",
      response.status,
      error.code,
    );
  }

  return (await response.json()) as T;
}

export async function callServiceRpc<T>(
  env: Bindings,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new SupabaseRpcError("supabase_service_not_configured", 503);
  }

  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as SupabaseErrorBody;
    throw new SupabaseRpcError(
      error.message ?? "supabase_service_rpc_failed",
      response.status,
      error.code,
    );
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
