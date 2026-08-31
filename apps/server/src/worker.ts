import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import { processOutbox } from "./outbox.js";

const app = createApp();

export function withSecurityHeaders(response: Response, requestUrl: string, supabaseUrl: string) {
  const headers = new Headers(response.headers);
  const supabaseOrigin = new URL(supabaseUrl).origin;
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; "));
  headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (new URL(requestUrl).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Bindings, executionContext: ExecutionContext) {
    const response = await app.fetch(request, env, executionContext);
    const url = new URL(request.url);

    if (response.status !== 404 || url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(response, request.url, env.SUPABASE_URL);
    }

    if (!env.ASSETS) return withSecurityHeaders(response, request.url, env.SUPABASE_URL);

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith("/client") || url.pathname.startsWith("/s/")) {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "private, no-store");
      return withSecurityHeaders(
        new Response(assetResponse.body, { status: assetResponse.status, headers }),
        request.url,
        env.SUPABASE_URL,
      );
    }
    return withSecurityHeaders(assetResponse, request.url, env.SUPABASE_URL);
  },
  scheduled(_controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    executionContext.waitUntil(processOutbox(env));
  },
};
