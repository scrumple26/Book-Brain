import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const MODEL = "gemini-2.5-flash";
const PROMPT_PREFIX =
  "Clean up this voice-dictated note. Be aggressive about adding commas: after introductory phrases, before coordinating conjunctions (and, but, or, so, yet), between list items, after transitional words (however, therefore, finally, also, etc.), and wherever a natural spoken pause would occur. Also add periods and other missing punctuation. Fix capitalization and grammar errors. Keep every word — do not remove, omit, or summarize any content. Output only the corrected text, with no quotes, no labels, no explanation.\n\nNote:\n";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return NextResponse.json({ error: "text required" }, { status: 400 });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT_PREFIX + raw }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json({ error: `Gemini API error: ${res.status} ${errText}` }, { status: 502 });
  }

  const data = await res.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polished = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!polished) {
    return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 });
  }
  return NextResponse.json({ text: polished });
}
