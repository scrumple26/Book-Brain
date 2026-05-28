import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const MODEL = "gemini-2.5-flash";
const PROMPT_PREFIX =
  "You are a strict grammar editor for voice-dictated notes. Apply every rule below without exception.\n\n" +
  "COMMAS — you must add a comma in each of these situations, no exceptions:\n" +
  "1. After every introductory word, phrase, or clause that begins a sentence (when, although, after, before, despite, because, if, since, as, while, however, therefore, moreover, furthermore, additionally, finally, also, in addition, as a result, for example, in fact, of course, on the other hand, at the same time, etc.). Example: 'When he arrived he saw the crowd' → 'When he arrived, he saw the crowd.'\n" +
  "2. Before a coordinating conjunction (and, but, or, so, yet, for, nor) when it joins two independent clauses. Example: 'He played well but he missed the last shot' → 'He played well, but he missed the last shot.'\n" +
  "3. Between every item in a list of three or more. Example: 'red white and blue' → 'red, white, and blue.'\n" +
  "4. After a transition word at the start of a sentence: However, Therefore, Moreover, Furthermore, Additionally, Finally, Also, Meanwhile, Nevertheless, Consequently, In contrast, As a result.\n" +
  "5. To set off appositives and non-essential phrases. Example: 'Pep Guardiola the manager said' → 'Pep Guardiola, the manager, said.'\n\n" +
  "CAPITALIZATION — capitalize every proper noun without exception:\n" +
  "- People's names, nicknames, and titles used with names (Pep Guardiola, Coach Smith)\n" +
  "- Sports teams, clubs, organizations (FC Barcelona, Real Madrid, the UN)\n" +
  "- Cities, countries, regions, stadiums (Barcelona, Spain, Camp Nou)\n" +
  "- Months and days of the week (January, Monday)\n" +
  "- Nationalities, languages, religions (Spanish, English, Catholic)\n" +
  "- Schools and universities (Harvard, MIT)\n" +
  "- Titles of books, films, songs, shows (The Alchemist, Breaking Bad)\n" +
  "- Historical events and periods (World War II, the Renaissance)\n" +
  "- Specific named entities of any kind — when in doubt, capitalize it.\n" +
  "Do NOT capitalize ordinary common nouns.\n\n" +
  "OTHER RULES:\n" +
  "- Add a period at the end of every complete sentence. Do not leave any sentence boundary without a period.\n" +
  "- Fix grammar and agreement errors.\n" +
  "- Keep every word — do not remove, omit, or summarize any content.\n" +
  "- Preserve all punctuation symbols as-is, including ( ) and \\\".\n" +
  "- Output only the corrected text, with no quotes, labels, or explanation.\n\nNote:\n";

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
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
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
