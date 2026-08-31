const HEX = "0123456789abcdef";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashShopCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function signaturesMatch(expected: string, received: string) {
  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createShopCode(codeId: string, secret: string) {
  const payload = `b1.${codeId}`;
  return `${payload}.${base64Url(await hmac(payload, secret))}`;
}

export async function verifyShopCode(code: string, secret: string) {
  const parts = code.split(".");
  if (parts.length !== 3 || parts[0] !== "b1") return false;
  const [version, codeId, signature] = parts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(codeId)) return false;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(signature)) return false;
  const payload = `${version}.${codeId}`;
  return signaturesMatch(base64Url(await hmac(payload, secret)), signature);
}

export async function createShareToken(shareLinkId: string, expiresAt: string, secret: string) {
  const expires = Math.floor(new Date(expiresAt).getTime() / 1000);
  const payload = `s1.${shareLinkId}.${expires}`;
  return `${payload}.${base64Url(await hmac(payload, secret))}`;
}

export async function verifyShareToken(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "s1") return null;
  const [version, shareLinkId, expiresText, signature] = parts;
  if (!shareLinkId || !/^\d+$/.test(expiresText) || !/^[A-Za-z0-9_-]{40,60}$/.test(signature)) return null;
  const payload = `${version}.${shareLinkId}.${expiresText}`;
  const expected = base64Url(await hmac(payload, secret));
  if (!signaturesMatch(expected, signature) || Number(expiresText) <= Math.floor(Date.now() / 1000)) return null;
  return { shareLinkId, expiresAt: new Date(Number(expiresText) * 1000).toISOString() };
}

export function generateLegacyShopCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => HEX[byte >> 4] + HEX[byte & 15]).join("");
}
