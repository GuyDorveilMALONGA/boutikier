import assert from "node:assert/strict";
import test from "node:test";
import { withSecurityHeaders } from "./worker.js";

test("production responses receive restrictive browser security headers", () => {
  const response = withSecurityHeaders(
    new Response("ok"),
    "https://boutikier.example/",
    "https://project.supabase.co",
  );

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'self' https:\/\/project\.supabase\.co wss:\/\/project\.supabase\.co/);
  assert.equal(response.headers.get("permissions-policy"), "camera=(self), geolocation=(), microphone=()");
});

test("local HTTP responses do not advertise HSTS", () => {
  const response = withSecurityHeaders(
    new Response("ok"),
    "http://127.0.0.1:8787/",
    "http://127.0.0.1:56321",
  );
  assert.equal(response.headers.has("strict-transport-security"), false);
});
