const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:56321";
const apiUrl = process.env.BOUTIKIER_API_URL || "http://127.0.0.1:8787";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const testOtp = "123456";

const demo = {
  client: { phone: "+221777629953", name: "Client Démo" },
  shop: { phone: "+221703549365", name: "Boutique Démo" },
};

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${url}: ${JSON.stringify(payload)}`);
  return payload;
}

async function authRequest(path, body) {
  return jsonRequest(`${supabaseUrl}/auth/v1${path}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function api(token, path, init = {}) {
  return jsonRequest(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function login(phone) {
  let sent;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone, create_user: true }),
    });
    if (response.status !== 429) { sent = response; break; }
    await new Promise((resolve) => setTimeout(resolve, 5_100));
  }
  if (!sent?.ok) throw new Error(`${sent?.status ?? "no response"} OTP ${phone}: ${await sent?.text()}`);
  return authRequest("/verify", { phone, token: testOtp, type: "sms" });
}

async function ensureActor(kind, actor) {
  const session = await login(actor.phone);
  const context = await api(session.access_token, "/api/me");
  if (context.needsOnboarding) {
    await api(session.access_token, `/api/onboarding/${kind}`, {
      method: "POST",
      body: JSON.stringify(kind === "shop" ? { name: actor.name } : { displayName: actor.name }),
    });
  }
  return session.access_token;
}

const clientToken = await ensureActor("client", demo.client);
const shopToken = await ensureActor("shop", demo.shop);
const existing = await api(shopToken, `/api/shop/clients?q=${encodeURIComponent(demo.client.phone)}`);
let relationship = existing.items.find((item) => item.phoneE164 === demo.client.phone);
if (!relationship) {
  relationship = await api(shopToken, "/api/shop/clients", {
    method: "POST",
    body: JSON.stringify({
      name: demo.client.name,
      phoneRaw: "77 762 99 53",
      phoneE164: demo.client.phone,
    }),
  });
}

const clientHome = await api(clientToken, "/api/client/home");
let linked = clientHome.relationships.some((item) => item.shopClient.id === relationship.id);
if (!linked) {
  const qr = await api(shopToken, "/api/shop/qr", { method: "POST" });
  await api(clientToken, "/api/shop/connect", {
    method: "POST",
    body: JSON.stringify({ code: qr.code }),
  });
  const refreshedHome = await api(clientToken, "/api/client/home");
  linked = refreshedHome.relationships.some((item) => item.shopClient.id === relationship.id);
}
if (!linked) throw new Error("The real QR connection completed but the demo relationship is still unavailable.");

console.log(JSON.stringify({
  client: { phone: "777629953", pin: "1234", name: demo.client.name },
  shop: { phone: "703549365", pin: "1234", name: demo.shop.name },
  relationshipId: relationship.id,
  storage: "Supabase local with authenticated sessions and RLS",
}, null, 2));
