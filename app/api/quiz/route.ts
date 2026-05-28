import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
const MODEL = "gemini-2.5-flash";
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no key" }, { status: 500 });
  let body: { notes?: unknown }; try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const notes = Array.isArray(body.notes) ? (body.notes as unknown[]).filter(n => typeof n === "string") as string[] : [];
  if (!notes.length) return NextResponse.json({ error: "notes required" }, { status: 400 });
  const prompt = `Based on these book notes, generate exactly 8 quiz questions. Mix types: fill-in-the-blank, true/false, and short-answer. Return ONLY a JSON array: [{"question":"...","answer":"..."}]. No extra text.\n\nNotes:\n${notes.slice(0, 60).join("\n")}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } }) });
  if (!res.ok) return NextResponse.json({ error: "gemini error" }, { status: 502 });
  const data = await res.json().catch(() => null);
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return NextResponse.json({ error: "bad format" }, { status: 502 });
  try { return NextResponse.json({ questions: JSON.parse(m[0]) }); } catch { return NextResponse.json({ error: "parse error" }, { status: 502 }); }
}
