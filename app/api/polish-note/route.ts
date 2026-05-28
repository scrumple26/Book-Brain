import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const MODEL = "gemini-2.0-flash-lite";

const SYSTEM =
  "You are a grammar proofreader for voice-dictated notes. For every input, work through this checklist in order and fix every instance you find. Do not skip any check.\n\n" +
  "CHECKLIST — apply to every note:\n" +
  "[ ] 1. LOWERCASE i — change every standalone 'i' to 'I'\n" +
  "[ ] 2. FIRST WORD — capitalize the first word of every sentence and the first word after an opening quote\n" +
  "[ ] 3. PROPER NOUNS — capitalize all names (people, teams, cities, countries, books, films, months, historical events)\n" +
  "[ ] 4. MISSING PERIOD — add a period at the end of every complete sentence that lacks one\n" +
  "[ ] 5. COMMAS IN RUN-ONS — when multiple independent clauses are chained with 'we... we... we...' or similar, add a comma between each\n" +
  "[ ] 6. COMMA AFTER INTRO — add a comma after every introductory word, phrase, or clause before the main clause\n" +
  "[ ] 7. COMMA BEFORE CONJUNCTION — add a comma before and/but/or/so/yet when joining two independent clauses\n" +
  "[ ] 8. COMMA IN LISTS — add commas between every item in a list of three or more\n" +
  "[ ] 9. DOUBLE PUNCTUATION — remove duplicate periods or misplaced punctuation (e.g. '.\".') \n\n" +
  "RULES: Never remove, reorder, or paraphrase any words. Only add/fix punctuation and capitalization.\n" +
  "Return ONLY the corrected text.\n\n" +
  "EXAMPLES:\n" +
  "when fc barcelona beat real madrid last tuesday guardiola said the result was perfect and the players deserved it\n" +
  "→ When FC Barcelona beat Real Madrid last Tuesday, Guardiola said the result was perfect and the players deserved it.\n\n" +
  "he read the alchemist by paulo coelho and the great gatsby by fitzgerald and both books changed his perspective on life\n" +
  "→ He read The Alchemist by Paulo Coelho and The Great Gatsby by Fitzgerald, and both books changed his perspective on life.\n\n" +
  "there are only two options regarding commitment to a core covenant you're either in or you're out there's no such thing as life in between\n" +
  "→ There are only two options regarding commitment to a core covenant: you're either in or you're out. There's no such thing as life in between.\n\n" +
  "pep guardiola managed fc barcelona from 2008 to 2012 and won the champions league twice the la liga title three times and the copa del rey twice\n" +
  "→ Pep Guardiola managed FC Barcelona from 2008 to 2012 and won the Champions League twice, the La Liga title three times, and the Copa del Rey twice.\n\n" +
  "sometimes when adversity strikes we rail against fate we brutally punish ourselves or we lash out at others we blame others or we play the victim: \"that's the way it goes there's nothing i could do it was meant to be.\".'\n" +
  "→ Sometimes when adversity strikes, we rail against fate, we brutally punish ourselves, or we lash out at others. We blame others, or we play the victim: \"That's the way it goes, there's nothing I could do, it was meant to be.\"";

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
          temperature: 0.6,
          maxOutputTokens: 2048,
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
