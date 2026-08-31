import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import type { Bindings } from "./env.js";

const app = createApp();
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const env: Bindings = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  APP_HMAC_SECRET: process.env.APP_HMAC_SECRET,
  APP_ORIGIN: process.env.APP_ORIGIN,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
};

app.use("/*", serveStatic({ root: webRoot }));
app.get(
  "*",
  serveStatic({
    root: webRoot,
    rewriteRequestPath: () => "/index.html",
  }),
);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: (request) => app.fetch(request, env), port });

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Boutikier server listening on port ${port}`);
