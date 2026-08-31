import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL = "http://127.0.0.1:56321";
const API_URL = "http://127.0.0.1:8790";
const PUBLISHABLE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SHOP_PHONE = "+221770000001";
const CLIENT_PHONE = "+221770000002";
const DEMO_SHOP_PHONE = "+221703549365";
const DEMO_CLIENT_PHONE = "+221777629953";
const OTP = "123456";

let shopClientId = "";
let shopAccessToken = "";

async function jsonRequest<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${url}: ${JSON.stringify(payload)}`);
  return payload as T;
}

async function otpLogin(phone: string) {
  const headers = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" };
  let sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST", headers, body: JSON.stringify({ phone, create_user: true }),
  });
  if (sent.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
      method: "POST", headers, body: JSON.stringify({ phone, create_user: true }),
    });
  }
  if (!sent.ok) throw new Error(`${sent.status} OTP ${phone}: ${await sent.text()}`);
  return jsonRequest<{ access_token: string }>(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST", headers, body: JSON.stringify({ phone, token: OTP, type: "sms" }),
  });
}

async function api<T>(token: string, path: string, init: RequestInit = {}) {
  return jsonRequest<T>(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function loginThroughUi(page: Page, phone: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Créer votre compte" })).toBeVisible();
  await expect(page.getByLabel("Votre nom complet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Boutiquier" })).toBeVisible();
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ouvrir votre espace" })).toBeVisible();
  await expect(page.getByLabel("Votre nom complet")).toHaveCount(0);
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("button", { name: "Recevoir plutôt le code par SMS" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre numéro" })).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(OTP);
  await page.getByRole("button", { name: "Vérifier et continuer" }).click();
}

async function demoLoginThroughUi(page: Page, phone: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("button", { name: "Recevoir plutôt le code par SMS" }).click();
  await expect(page.getByLabel("Code à 4 chiffres")).toBeVisible();
  await page.getByLabel("Code à 4 chiffres").fill("1234");
  await page.getByRole("button", { name: "Vérifier et continuer" }).click();
}

test.beforeAll(async () => {
  const shopLogin = await otpLogin(SHOP_PHONE);
  shopAccessToken = shopLogin.access_token;
  const shopMe = await api<{ needsOnboarding: boolean }>(shopLogin.access_token, "/api/me");
  if (shopMe.needsOnboarding) {
    await api(shopLogin.access_token, "/api/onboarding/shop", {
      method: "POST", body: JSON.stringify({ name: "Boutique Test" }),
    });
  }

  const clientLogin = await otpLogin(CLIENT_PHONE);
  const clientMe = await api<{ needsOnboarding: boolean }>(clientLogin.access_token, "/api/me");
  if (clientMe.needsOnboarding) {
    await api(clientLogin.access_token, "/api/onboarding/client", {
      method: "POST", body: JSON.stringify({ displayName: "Cliente Test" }),
    });
  }

  const clients = await api<{ items: Array<{ id: string; phoneE164: string | null }> }>(shopLogin.access_token, "/api/shop/clients");
  const existing = clients.items.find((client) => client.phoneE164 === CLIENT_PHONE);
  if (existing) {
    shopClientId = existing.id;
  } else {
    const created = await api<{ id: string }>(shopLogin.access_token, "/api/shop/clients", {
      method: "POST",
      body: JSON.stringify({ name: "Cliente Test", phoneRaw: "77 000 00 02", phoneE164: CLIENT_PHONE }),
    });
    shopClientId = created.id;
  }

  const qr = await api<{ code: string }>(shopLogin.access_token, "/api/shop/qr", { method: "POST" });
  await api(clientLogin.access_token, "/api/shop/connect", {
    method: "POST", body: JSON.stringify({ code: qr.code }),
  });

  const relationship = await api<{ entries: unknown[] }>(shopLogin.access_token, `/api/shop/clients/${shopClientId}`);
  if (relationship.entries.length === 0) {
    await api(shopLogin.access_token, "/api/operations", {
      method: "POST",
      body: JSON.stringify({
        shopClientId,
        type: "debt",
        title: "Article de test réel",
        amountXof: 2_500,
        sourceChannel: "app",
        idempotencyKey: crypto.randomUUID(),
        duplicateOverride: false,
      }),
    });
  }

  const demoClientLogin = await otpLogin(DEMO_CLIENT_PHONE);
  const demoClientMe = await api<{ needsOnboarding: boolean }>(demoClientLogin.access_token, "/api/me");
  if (demoClientMe.needsOnboarding) {
    await api(demoClientLogin.access_token, "/api/onboarding/client", {
      method: "POST", body: JSON.stringify({ displayName: "Client Démo" }),
    });
  }

  const demoShopLogin = await otpLogin(DEMO_SHOP_PHONE);
  const demoShopMe = await api<{ needsOnboarding: boolean }>(demoShopLogin.access_token, "/api/me");
  if (demoShopMe.needsOnboarding) {
    await api(demoShopLogin.access_token, "/api/onboarding/shop", {
      method: "POST", body: JSON.stringify({ name: "Boutique Démo" }),
    });
  }
  const demoClients = await api<{ items: Array<{ id: string; phoneE164: string | null }> }>(demoShopLogin.access_token, "/api/shop/clients");
  if (!demoClients.items.some((client) => client.phoneE164 === DEMO_CLIENT_PHONE)) {
    await api(demoShopLogin.access_token, "/api/shop/clients", {
      method: "POST",
      body: JSON.stringify({ name: "Client Démo", phoneRaw: "77 762 99 53", phoneE164: DEMO_CLIENT_PHONE }),
    });
  }
  const demoQr = await api<{ code: string }>(demoShopLogin.access_token, "/api/shop/qr", { method: "POST" });
  await api(demoClientLogin.access_token, "/api/shop/connect", {
    method: "POST", body: JSON.stringify({ code: demoQr.code }),
  });

});

test("the four-digit local demo PIN opens real client and shop accounts", async ({ page }) => {
  await demoLoginThroughUi(page, DEMO_CLIENT_PHONE);
  await expect(page.getByRole("heading", { name: "Votre situation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Boutique Démo/ })).toBeVisible();
  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();

  await demoLoginThroughUi(page, DEMO_SHOP_PHONE);
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Client Démo/ })).toBeVisible();
});

test("the shop UI reads live summary and relationship data", async ({ page }) => {
  test.setTimeout(60_000);
  await new Promise((resolve) => setTimeout(resolve, 5_100));
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginThroughUi(page, SHOP_PHONE);

  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByLabel("Résumé de la boutique")).toContainText("À recevoir");
  await expect(page.getByRole("button", { name: /Cliente Test/i })).toBeVisible();
  await page.getByRole("button", { name: /Cliente Test/i }).click();
  await expect(page.getByText("Solde enregistré")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une dette" })).toBeVisible();
  await expect(page.getByRole("button", { name: /espace client/i })).toHaveCount(0);
  await page.goto("/client/scanner");
  await expect(page.getByRole("heading", { name: "Accès non disponible" })).toBeVisible();
  await expect(page.getByText("Seul un client vérifié peut scanner une boutique.")).toBeVisible();
});

test("the client records a new debt into the same live journal", async ({ page }) => {
  test.setTimeout(60_000);
  await new Promise((resolve) => setTimeout(resolve, 5_100));
  await loginThroughUi(page, CLIENT_PHONE);

  await expect(page.getByRole("heading", { name: "Votre situation" })).toBeVisible();
  await page.getByRole("button", { name: "Masquer les montants" }).click();
  await expect(page.getByText("******", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Nouvelle opération" })).toBeVisible();
  await page.getByRole("tab", { name: "Remboursement" }).click();
  await expect(page.getByLabel("Montant remboursé")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nouvelle opération" })).toBeVisible();
  await page.getByRole("tab", { name: "Achat à crédit" }).click();
  const title = `Achat E2E ${Date.now()}`;
  await page.getByLabel("Nom de l'article ou service").fill(title);
  await page.getByLabel("Prix total").fill("1750");
  await page.getByRole("button", { name: "Enregistrer l'achat" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Achat ajouté au journal" })).toBeVisible();
  await expect(page.getByLabel("Nom de l'article ou service")).toHaveValue("");
  await page.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByText("Activité récente")).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mes relevés" }).click();
  await expect(page.getByLabel("Boutique consultée")).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Afficher les montants" }).click();
  await expect(page.getByRole("button", { name: "Masquer les montants" })).toBeVisible();
});

test("a real shared statement remains strictly read-only", async ({ page }) => {
  const share = await api<{ token: string }>(shopAccessToken, `/api/relationships/${shopClientId}/share-links`, {
    method: "POST", body: JSON.stringify({ ttlDays: 7 }),
  });
  const statementResponse = page.waitForResponse((response) => response.url().includes("/api/public/statements/"));
  await page.goto(`/s/${share.token}`);
  const statement = await statementResponse;
  const statementBody = await statement.text();
  expect(statement.status(), `public statement API ${statement.url()}: ${statementBody}`).toBe(200);
  await expect(page.getByText("Lien privé")).toBeVisible();
  await expect(page.getByText("Lecture seule", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Ajouter|Corriger|Contester/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ouvrir mon espace" })).toHaveAttribute("href", "/client");
});
