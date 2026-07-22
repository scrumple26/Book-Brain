/**
 * The shared front door for every Book Brain AI route.
 *
 * One implementation on purpose. The deleted Gemini routes each carried their
 * own (absent) auth story, and /api/transcribe had to have its checks retrofitted
 * later; a single guard means the next AI route cannot ship without them.
 *
 * Order matters: identity, then entitlement, then spend. Each step is cheaper
 * and more certain than the next, and none of them cost money.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifyIdToken, type VerifiedUser } from "./verifyIdToken";
import { capabilitiesFor, serverPremiumUids, type AiCapability } from "./capabilities";

export type GuardOutcome =
  | { ok: true; user: VerifiedUser }
  | { ok: false; response: NextResponse };

export async function guardAiRoute(
  req: NextRequest,
  capability: AiCapability,
): Promise<GuardOutcome> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "NEXT_PUBLIC_FIREBASE_PROJECT_ID not set — cannot verify callers" },
        { status: 501 },
      ),
    };
  }

  const bearer = req.headers.get("authorization") ?? "";
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Sign-in required" }, { status: 401 }) };
  }

  let user: VerifiedUser;
  try {
    user = await verifyIdToken(token, projectId);
  } catch (e) {
    console.warn("ai route: rejected token —", e instanceof Error ? e.message : e);
    return { ok: false, response: NextResponse.json({ error: "Sign-in required" }, { status: 401 }) };
  }

  if (!capabilitiesFor(user.uid, serverPremiumUids()).has(capability)) {
    console.warn(`ai route: uid ${user.uid} lacks capability "${capability}"`);
    return {
      ok: false,
      response: NextResponse.json({ error: "Book Brain is a premium feature" }, { status: 403 }),
    };
  }

  return { ok: true, user };
}
