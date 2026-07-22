/**
 * Firebase ID-token verification for Edge route handlers.
 *
 * The Admin SDK can't run on the edge runtime (and would need a service-account
 * key), so this verifies the RS256 JWT directly against Google's published
 * signing keys using Web Crypto — no dependencies, no extra secrets.
 *
 * Checks performed: signature, RS256 alg, issuer + audience match the Firebase
 * project, and exp/iat are sane. That is what makes a caller provably a
 * signed-in user of THIS project rather than an anonymous stranger.
 */

const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** Small clock-skew allowance so a freshly minted token isn't rejected. */
const SKEW_SECONDS = 60;

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

// Google rotates these keys roughly daily and sends a max-age; cache until then.
let keyCache: { keys: Map<string, Jwk>; expiresAt: number } | null = null;

async function getSigningKey(kid: string): Promise<Jwk | null> {
  const now = Date.now();
  if (!keyCache || keyCache.expiresAt <= now) {
    const res = await fetch(JWK_URL);
    if (!res.ok) throw new Error(`Could not fetch Google signing keys: ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, Jwk>();
    for (const key of body.keys ?? []) {
      if (key.kid) keys.set(key.kid, key);
    }
    // honour Cache-Control when present, else re-fetch in an hour
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1]);
    const ttlMs = Number.isFinite(maxAge) && maxAge > 0 ? maxAge * 1000 : 3_600_000;
    keyCache = { keys, expiresAt: now + ttlMs };
  }
  return keyCache.keys.get(kid) ?? null;
}

/** Backed by a plain ArrayBuffer so the result satisfies BufferSource for
 *  crypto.subtle (a bare Uint8Array widens to ArrayBufferLike and is rejected). */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
  } catch {
    return null;
  }
}

export interface VerifiedUser {
  uid: string;
  email: string;
}

/**
 * Resolve a bearer token to its user, or throw. The thrown message is safe to
 * log but should not be echoed to the caller verbatim.
 */
export async function verifyIdToken(token: string, projectId: string): Promise<VerifiedUser> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload) throw new Error("Unreadable token");
  if (header.alg !== "RS256") throw new Error(`Unexpected alg ${String(header.alg)}`);

  const kid = typeof header.kid === "string" ? header.kid : "";
  const jwk = kid ? await getSigningKey(kid) : null;
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    signed,
  );
  if (!valid) throw new Error("Bad signature");

  // A valid signature from Google is not enough on its own — the token must
  // also have been minted for THIS project, or any Firebase token would pass.
  if (payload.aud !== projectId) throw new Error("Wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("Wrong issuer");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  if (!Number.isFinite(exp) || exp + SKEW_SECONDS < now) throw new Error("Token expired");
  if (!Number.isFinite(iat) || iat - SKEW_SECONDS > now) throw new Error("Token from the future");

  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) throw new Error("Token has no subject");

  return { uid, email: typeof payload.email === "string" ? payload.email : "" };
}
