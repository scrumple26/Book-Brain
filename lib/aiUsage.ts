/**
 * The shared AI spend counter — server-side only.
 *
 * Lives at the ROOT of Firestore (`aiUsage/{YYYY-MM}`), not under
 * `users/{uid}/`, because the budget is universal across all accounts rather
 * than per-user. That placement is what forces server ownership: a global
 * counter a client can write is a global counter any signed-in account can
 * reset.
 *
 * Firestore rules must DENY all client access to this collection. The only
 * writer is this module, authenticated as the service account.
 *
 * Every function throws on failure so callers fail CLOSED — the same invariant
 * lib/aqua.ts relies on (`fetchAquaSecondsUsed` throws rather than reporting
 * zero, so an unreadable meter disables spending instead of uncapping it).
 */
import { aiMonthKey } from "./ai";
import { getAccessToken, serviceAccountFromEnv, type ServiceAccountCreds } from "./serviceAccount";

const COLLECTION = "aiUsage";
const FIELD = "spendUsd";

function docPath(creds: ServiceAccountCreds, month: string): string {
  return `projects/${creds.projectId}/databases/(default)/documents/${COLLECTION}/${month}`;
}

function baseUrl(creds: ServiceAccountCreds): string {
  return `https://firestore.googleapis.com/v1/projects/${creds.projectId}/databases/(default)/documents`;
}

export class AiUsageUnavailableError extends Error {}

function requireCreds(): ServiceAccountCreds {
  const creds = serviceAccountFromEnv();
  if (!creds) {
    throw new AiUsageUnavailableError(
      "Service account not configured (FIREBASE_SA_CLIENT_EMAIL / FIREBASE_SA_PRIVATE_KEY)",
    );
  }
  return creds;
}

/** Dollars spent from the shared pool this month. Throws if it can't be read. */
export async function fetchAiSpendUsed(month = aiMonthKey()): Promise<number> {
  const creds = requireCreds();
  const token = await getAccessToken(creds);
  const res = await fetch(`${baseUrl(creds)}/${COLLECTION}/${month}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // A month with no spend yet simply has no document — that is zero, not an error.
  if (res.status === 404) return 0;
  if (!res.ok) {
    throw new AiUsageUnavailableError(`Could not read AI usage: ${res.status}`);
  }

  const data = (await res.json()) as {
    fields?: { [k: string]: { doubleValue?: number; integerValue?: string } };
  };
  const field = data.fields?.[FIELD];
  const value = field?.doubleValue ?? Number(field?.integerValue ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Add to the shared pool atomically.
 *
 * Uses a field transform rather than read-then-write: two concurrent AI calls
 * must not clobber each other's spend, which is exactly how a shared budget
 * quietly leaks. Pass a negative delta to reconcile an over-estimate downward.
 */
export async function addAiSpendUsed(deltaUsd: number, month = aiMonthKey()): Promise<void> {
  if (!Number.isFinite(deltaUsd) || deltaUsd === 0) return;
  const creds = requireCreds();
  const token = await getAccessToken(creds);

  const res = await fetch(`${baseUrl(creds)}:commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        {
          // Empty updateMask touches no existing fields; the transform does the
          // work, and the document is created if this is the month's first spend.
          update: { name: docPath(creds, month), fields: {} },
          updateMask: { fieldPaths: [] },
          updateTransforms: [{ fieldPath: FIELD, increment: { doubleValue: deltaUsd } }],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new AiUsageUnavailableError(`Could not record AI usage: ${res.status}`);
  }
}
