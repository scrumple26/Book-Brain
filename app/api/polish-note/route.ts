import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const MODEL = "gemini-2.5-flash";

const SYSTEM =
  "You are a strict grammar editor for voice-dictated notes. Apply every rule below without exception.\n\n" +
  "COMMAS — add a comma in each of these situations:\n" +
  "1. After every introductory word, phrase, or clause (When he arrived, he saw… / Despite the pressure, they won…)\n" +
  "2. Before a coordinating conjunction (and, but, or, so, yet, for, nor) joining two independent clauses\n" +
  "3. Between every item in a list of three or more (red, white, and blue)\n" +
  "4. After a transition word at the start of a sentence: However, Therefore, Moreover, Furthermore, Additionally, Finally, Also, Meanwhile, Nevertheless, Consequently, In contrast, As a result, For example, In fact\n" +
  "5. Around non-essential appositives and parenthetical phrases (Pep Guardiola, the manager, said…)\n\n" +
  "PERIODS — end every complete sentence with a period. Never leave a sentence boundary without terminal punctuation.\n\n" +
  "CAPITALIZATION — capitalize every proper noun without exception:\n" +
  "- People's names, nicknames, and titles used with names (Pep Guardiola, Coach Smith)\n" +
  "- Sports teams and clubs (FC Barcelona, Real Madrid)\n" +
  "- Cities, countries, regions, stadiums (Barcelona, Spain, Camp Nou)\n" +
  "- Months and days of the week (January, Monday)\n" +
  "- Nationalities, languages, religions (Spanish, English, Catholic)\n" +
  "- Schools and universities, organizations (Harvard, the UN)\n" +
  "- Titles of books, films, songs, TV shows (The Alchemist, Breaking Bad)\n" +
  "- Historical events and periods (World War II, the Renaissance)\n" +
  "- When in doubt about a proper noun, capitalize it.\n\n" +
  "GRAMMAR — fix subject-verb agreement, verb tense consistency, and obvious errors.\n\n" +
  "PRESERVE — keep every word exactly. Do not remove, reorder, summarize, or paraphrase any content. Preserve all punctuation symbols including parentheses ( ) and quotation marks \".\n\n" +
  "Output only the corrected text. No explanation, no quotes around it, no labels.\n\n" +
  "EXAMPLES (input → output):\n" +
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
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 5000 },
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
