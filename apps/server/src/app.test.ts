import assert from "node:assert/strict";
import test from "node:test";
import { healthResponseSchema } from "@boutikier/contracts";
import { createApp } from "./app.js";
import type { Bindings } from "./env.js";

const env: Bindings = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  APP_HMAC_SECRET: "test-hmac-secret-with-at-least-32-characters",
};

const operation = {
  shopClientId: "11111111-1111-4111-8111-111111111111",
  type: "debt",
  title: "Sac de riz",
  amountXof: 20_000,
  sourceChannel: "app",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
};

test("exposes a contract-validated health response", async () => {
  const response = await createApp().request("/api/health");

  assert.equal(response.status, 200);
  healthResponseSchema.parse(await response.json());
});

test("private statement routes are never cacheable", async () => {
  const response = await createApp().request("/s/missing");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("authenticated client routes are never cacheable", async () => {
  const response = await createApp().request("/client");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("unknown API routes never fall through to the web application", async () => {
  const response = await createApp().request("/api/missing");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("business routes require a Supabase bearer token", async () => {
  const response = await createApp().request(
    "/api/operations",
    { method: "POST", body: JSON.stringify(operation) },
    env,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("shop onboarding creates its first signed QR in the same command", async () => {
  const originalFetch = globalThis.fetch;
  let onboardingBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith("/rpc/complete_shop_onboarding_with_code")) {
      onboardingBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Chez Awa",
        phone_e164: "+221703549365",
        currency_code: "XOF",
      });
    }
    if (pathname.endsWith("/rpc/get_actor_context")) {
      return Response.json({
        auth_user_id: "22222222-2222-4222-8222-222222222222",
        phone_e164: "+221703549365",
        shop: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Chez Awa",
          phone_e164: "+221703549365",
          currency_code: "XOF",
        },
        client: null,
        default_audience: "shop",
        needs_onboarding: false,
      });
    }
    return Response.json({ error: "unexpected_rpc" }, { status: 500 });
  };

  try {
    const response = await createApp().request(
      "/api/onboarding/shop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer user-jwt",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Chez Awa" }),
      },
      env,
    );

    assert.equal(response.status, 201);
    assert.equal(onboardingBody?.p_name, "Chez Awa");
    assert.match(String(onboardingBody?.p_code_id), /^[0-9a-f-]{36}$/);
    assert.match(String(onboardingBody?.p_code_hash), /^[0-9a-f]{64}$/);
    assert.match(String(onboardingBody?.p_code_prefix), /^[0-9a-f]{8}$/);
    assert.equal(JSON.stringify(onboardingBody).includes("b1."), false);
    assert.equal((await response.json() as { shop: { name: string } }).shop.name, "Chez Awa");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("records an operation through the transaction RPC", async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    rpcBody = JSON.parse(String(init?.body));
    return Response.json({
      entry_id: "33333333-3333-4333-8333-333333333333",
      recorded: true,
      idempotent_replay: false,
      possible_duplicate_of: null,
    });
  };

  try {
    const response = await createApp().request(
      "/api/operations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer user-jwt",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(operation),
      },
      env,
    );

    assert.equal(response.status, 201);
    assert.equal(rpcBody?.p_entry_type, "debt");
    assert.equal(rpcBody?.p_amount_xof, 20_000);
    assert.equal(rpcBody?.p_idempotency_key, operation.idempotencyKey);
    assert.deepEqual(await response.json(), {
      entryId: "33333333-3333-4333-8333-333333333333",
      recorded: true,
      idempotentReplay: false,
      possibleDuplicateOf: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a conflict instead of silently inserting a probable duplicate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    recorded: false,
    reason: "probable_duplicate",
    possible_duplicate_of: "33333333-3333-4333-8333-333333333333",
  });

  try {
    const response = await createApp().request(
      "/api/operations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer user-jwt",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(operation),
      },
      env,
    );

    assert.equal(response.status, 409);
    const body = await response.json() as { reason: string };
    assert.equal(body.reason, "probable_duplicate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persists only a hash when rotating a shop QR code", async () => {
  const originalFetch = globalThis.fetch;
  let rotateBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith("/rpc/rotate_shop_public_code_with_id")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      rotateBody = body;
      return Response.json(body.p_code_id);
    }
    if (pathname.endsWith("/rpc/get_active_shop_code")) {
      return Response.json({
        code_id: rotateBody?.p_code_id,
        code_prefix: rotateBody?.p_code_prefix,
        created_at: "2026-08-31T00:00:00.000Z",
        revoked_at: null,
      });
    }
    return Response.json({ error: "unexpected_rpc" }, { status: 500 });
  };

  try {
    const response = await createApp().request(
      "/api/shop/qr",
      { method: "POST", headers: { Authorization: "Bearer user-jwt" } },
      env,
    );
    const body = await response.json() as { code: string; path: string };

    assert.equal(response.status, 201);
    assert.match(body.code, /^b1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    assert.equal(body.path, `/q/s/${body.code}`);
    assert.match(String(rotateBody?.p_code_hash), /^[0-9a-f]{64}$/);
    assert.notEqual(rotateBody?.p_code_hash, body.code);
    assert.match(String(rotateBody?.p_code_prefix), /^[a-f0-9]{8}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a forged shop QR before the privileged database lookup", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: "unexpected_rpc" }, { status: 500 });
  };

  try {
    const response = await createApp().request(
      "/api/qr/shops/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "b1.00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
      },
      env,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "shop_code_invalid" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves a legitimately signed shop QR through the database", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    assert.match(new URL(String(input)).pathname, /\/rpc\/resolve_shop_code$/);
    return Response.json({
      shop_id: "11111111-1111-4111-8111-111111111111",
      shop_name: "Boutique Diallo",
    });
  };

  try {
    const codeId = "22222222-2222-4222-8222-222222222222";
    const { createShopCode } = await import("./shop-codes.js");
    const code = await createShopCode(codeId, env.APP_HMAC_SECRET!);
    const response = await createApp().request(
      "/api/qr/shops/resolve",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
      env,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      shopId: "11111111-1111-4111-8111-111111111111",
      shopName: "Boutique Diallo",
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
