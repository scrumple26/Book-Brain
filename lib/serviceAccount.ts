/**
 * Google service-account access tokens, minted on the edge runtime.
 *
 * Why this exists: the AI budget is a SHARED pool, so its counter is a single
 * global document that no client may write — otherwise any signed-in account
 * could reset everyone's budget. But a rules-locked document needs a
 * privileged writer, and this stack has no Firebase Admin SDK (it can't run on
 * edge, and there is no service-account plumbing anywhere in the repo).
 *
 * So we do what the Admin SDK does internally: sign a JWT with the service
 * account's private key, exchange it for an OAuth access token, and call the
 * Firestore REST API with that. Signing uses Web Crypto — the same primitive
 * lib/verifyIdToken.ts already uses to verify ID tokens, just the other
 * direction — so this adds no dependency.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
/** Refresh a minute early so a token can't expire mid-request. */
const EXPIRY_SKEW_SECONDS = 60;

export interface ServiceAccountCreds {
  clientEmail: string;
  privateKey: string;
  projectId: string;
}

/**
 * Read credentials from the environment, or null if unconfigured. Callers must
 * treat null as "fail closed" (501), never as "proceed unmetered".
 */
export function serviceAccountFromEnv(): ServiceAccountCreds | null {
  const clientEmail = process.env.FIREBASE_SA_CLIENT_EMAIL;
  // Env vars can't hold real newlines, so the PEM is stored with literal "\n".
  const privateKey = process.env.FIREBASE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!clientEmail || !privateKey || !projectId) return null;
  return { clientEmail, privateKey, projectId };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** PEM (PKCS#8) -> CryptoKey for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// Access tokens last an hour; cache in module scope so a burst of requests on
// the same isolate doesn't mint one each time.
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(creds: ServiceAccountCreds): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - EXPIRY_SKEW_SECONDS > now) {
    return tokenCache.token;
  }

  const claims = {
    iss: creds.clientEmail,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson(claims)}`;
  const key = await importPrivateKey(creds.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Service-account token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Token exchange returned no access_token");

  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600),
  };
  return tokenCache.token;
}
