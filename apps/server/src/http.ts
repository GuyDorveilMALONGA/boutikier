import { SupabaseRpcError } from "./supabase.js";

export function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camelize(item),
    ]),
  );
}

export async function readJson(context: { req: { json(): Promise<unknown> } }) {
  try {
    return await context.req.json();
  } catch {
    throw new SupabaseRpcError("invalid_json", 400);
  }
}

export function requireSecret(value: string | undefined, name: string) {
  if (!value) throw new SupabaseRpcError(`${name.toLowerCase()}_not_configured`, 503);
  return value;
}

export function firstRow<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}
