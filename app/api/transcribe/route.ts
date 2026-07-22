import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/verifyIdToken";

export const runtime = "edge";

// Aqua Avalon: OpenAI-compatible batch transcription.
// Docs + API keys: https://app.aquavoice.com/api-dashboard
const DEFAULT_BASE = "https://api.aquavoice.com/api/v1";
const MODEL = "avalon-v1.5";

// Dictation sessions are capped at 60s client-side; a 60s opus clip is well
// under 1 MB. Anything bigger than 2 MB is not a legitimate utterance clip.
const MAX_BYTES = 2_000_000;

/**
 * Callers allowed to spend Aqua credit, as Firebase uids (comma-separated in
 * AQUA_ALLOWED_UIDS). Google sign-in accepts ANY Google account, so without
 * this list every stranger who signs in can bill audio to this key — the list
 * is what makes the endpoint personal rather than merely non-anonymous.
 */
function allowedUids(): string[] {
  return (process.env.AQUA_ALLOWED_UIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.AQUA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AQUA_API_KEY not set" }, { status: 501 });
  }

  // Spending money requires proving you are a signed-in user of this project.
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_FIREBASE_PROJECT_ID not set — cannot verify callers" },
      { status: 501 },
    );
  }

  const bearer = req.headers.get("authorization") ?? "";
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
  }

  let user;
  try {
    user = await verifyIdToken(token, projectId);
  } catch (e) {
    console.warn("transcribe: rejected token —", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
  }

  const allowed = allowedUids();
  if (allowed.length > 0 && !allowed.includes(user.uid)) {
    console.warn(`transcribe: uid ${user.uid} is not on AQUA_ALLOWED_UIDS`);
    return NextResponse.json({ error: "Not permitted to use dictation" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "clip too large" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name || "utterance.webm");
  upstream.append("model", MODEL);

  const base = process.env.AQUA_BASE_URL || DEFAULT_BASE;
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Aqua API error: ${res.status} ${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Empty transcription" }, { status: 502 });
  }
  return NextResponse.json({ text });
}
