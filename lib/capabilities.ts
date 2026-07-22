/**
 * Premium capability gating for the Book Brain AI hub.
 *
 * Deliberately a capability *set* rather than an `isAdmin` boolean: hub access,
 * the whole-library lens, the Opus "deep answer" tier and Smart Import are
 * gated independently and will not stay in lockstep. A future paid tier is a
 * different capability set, not a second code path.
 *
 * The server check is the control; any client-side check is cosmetic (it hides
 * UI, it does not protect spend). Both read the same pure function so they
 * cannot drift.
 */

export type AiCapability = "hub" | "lens:all" | "deep-answer" | "smart-import";

export const ALL_CAPABILITIES: readonly AiCapability[] = [
  "hub",
  "lens:all",
  "deep-answer",
  "smart-import",
];

/** Parse a comma-separated uid allowlist (same shape as AQUA_ALLOWED_UIDS). */
export function parseUidList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Capabilities held by a uid.
 *
 * NOTE the deliberate difference from AQUA_ALLOWED_UIDS: an *empty* premium
 * list grants nothing. Aqua's empty list means "don't narrow the default",
 * because dictation is the app's core feature. This is a paid gate on a shared
 * budget, so an unset env var must fail closed — otherwise a missing
 * deploy-time variable silently hands every signed-in Google account the keys
 * to the AI spend.
 */
export function capabilitiesFor(
  uid: string | null | undefined,
  premiumUids: string[],
): Set<AiCapability> {
  if (!uid || premiumUids.length === 0 || !premiumUids.includes(uid)) {
    return new Set();
  }
  return new Set(ALL_CAPABILITIES);
}

export function hasCapability(
  uid: string | null | undefined,
  premiumUids: string[],
  capability: AiCapability,
): boolean {
  return capabilitiesFor(uid, premiumUids).has(capability);
}

/** Server-side premium list. Never exposed to the browser. */
export function serverPremiumUids(): string[] {
  return parseUidList(process.env.AI_ADMIN_UIDS);
}

/**
 * Client-side premium list, for hiding UI only. A user who edits this out of
 * the bundle still gets a 403 from every route — that is the intended
 * relationship between the two checks.
 */
export function clientPremiumUids(): string[] {
  return parseUidList(process.env.NEXT_PUBLIC_AI_ADMIN_UIDS);
}
