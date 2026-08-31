import { healthResponseSchema, type HealthResponse } from "@boutikier/contracts";
import { Hono } from "hono";
import type { Bindings } from "./env.js";
import { registerAuthRoutes } from "./modules/auth.js";
import { registerClientRoutes } from "./modules/client.js";
import { registerOperationRoutes } from "./modules/operations.js";
import { registerSharingRoutes } from "./modules/sharing.js";
import { registerShopRoutes } from "./modules/shop.js";
import { SupabaseRpcError } from "./supabase.js";

export function createApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  const health = healthResponseSchema.parse({
    status: "ok",
    service: "boutikier-server",
  }) satisfies HealthResponse;

  const preventPrivateCaching = async (
    context: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>,
  ) => {
    await next();
    context.header("Cache-Control", "private, no-store");
  };

  app.use("/api/*", preventPrivateCaching);
  app.use("/s/*", preventPrivateCaching);
  app.use("/client*", preventPrivateCaching);

  app.get("/health", (context) => context.json(health));
  app.get("/api/health", (context) => context.json(health));

  registerAuthRoutes(app);
  registerShopRoutes(app);
  registerClientRoutes(app);
  registerOperationRoutes(app);
  registerSharingRoutes(app);

  app.all("/api/*", (context) => context.json({ error: "not_found" }, 404));

  app.onError((error, context) => {
    if (error instanceof SupabaseRpcError) {
      return context.json({ error: error.message, code: error.code }, error.status as 400);
    }
    if (error instanceof Error && error.name === "ZodError") {
      return context.json({ error: "invalid_request" }, 400);
    }
    console.error(error);
    return context.json({ error: "internal_error" }, 500);
  });

  return app;
}
