import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const MODEL = "gemini-2.5-flash";

const SYSTEM =
  "You are a grammar corrector for voice-dictated notes. ALWAYS make corrections — never return text unchanged.\n\n" +
  "REQUIRED corrections on every note:\n" +
  "1. ADD commas: after introductory phrases, before and/but/or/so joining two sentences, between list items\n" +
  "2. CAPITALIZE all proper nouns: people, teams, cities, books, films, months, historical events\n" +
  "3. ADD a period at the end of every complete sentence\n" +
  "4. FIX grammar errors\n\n" +
  "Do NOT remove, reorder, or paraphrase words. Only add punctuation and fix capitalization.\n" +
  "Return ONLY the corrected text.\n\n" +
  "EXAMPLES:\n" +
  "when fc barcelona beat real madrid last tuesday guardiola said the result was perfect and the players deserved it\n" +
  "→ When FC Barcelona beat Real Madrid last Tuesday, Guardiola said the result was perfect and the players deserved it.\n\n" +
  "he read the alchemist by paulo coelho and the great gatsby by fitzgerald and both books changed his perspective on life\n" +
  "→ He read The Alchemist by Paulo Coelho and The Great Gatsby by Fitzgerald, and both books changed his perspective on life.\n\n" +
  "there are only two options regarding commitment to a core covenant you're either in or you're out there's no such thing as life in between\n" +
  "→ There are only two options regarding commitment to a core covenant: you're either in or you're out. There's no such thing as life in between.\n\n" +
  "pep guardiola managed fc barcelona from 2008 to 2012 and won the champions league twice the la liga title three times and the copa del rey twice\n" +
  "→ Pep Guardiola managed FC Barcelona from 2008 to 2012 and won the Champions League twice, the La Liga title three times, and the Copa del Rey twice.";

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
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: raw }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json({ error: `Gemini API error: ${res.status} ${errText}` }, { status: 502 });
  }

  const data = await res.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: { text?: string; thought?: boolean }[] = (data as any)?.candidates?.[0]?.content?.parts ?? [];
  const polished = parts.find((p) => !p.thought && p.text)?.text?.trim();
  if (!polished) {
    return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 });
  }
  return NextResponse.json({ text: polished });
}
