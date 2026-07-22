import { NextResponse, type NextRequest } from "next/server";
import { guardAiRoute } from "@/lib/aiRouteGuard";
import {
  AI_MODEL_DEFAULT,
  approxTokens,
  costFromUsage,
  estimateCostUsd,
  wouldExceedCap,
} from "@/lib/ai";
import { AiUsageUnavailableError, addAiSpendUsed, fetchAiSpendUsed } from "@/lib/aiUsage";
import {
  QUIZ_MAX_NOTES,
  QUIZ_MAX_OUTPUT_TOKENS,
  QUIZ_SCHEMA,
  QUIZ_SYSTEM_PROMPT,
  buildQuizUserMessage,
  parseQuizResponse,
  type QuizSourceNote,
} from "@/lib/quizPrompt";

export const runtime = "edge";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface RequestBody {
  title?: unknown;
  author?: unknown;
  notes?: unknown;
}

function parseNotes(raw: unknown): QuizSourceNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: QuizSourceNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, chapter, text } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof text !== "string" || !text.trim()) continue;
    notes.push({ id, chapter: typeof chapter === "string" ? chapter : "", text: text.trim() });
    if (notes.length >= QUIZ_MAX_NOTES) break;
  }
  return notes;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, "hub");
  if (!guard.ok) return guard.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 501 });
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  const notes = parseNotes(body?.notes);
  if (notes.length === 0) {
    return NextResponse.json({ error: "No notes to generate from" }, { status: 400 });
  }

  const userMessage = buildQuizUserMessage({
    title: typeof body?.title === "string" ? body.title : "Untitled",
    author: typeof body?.author === "string" ? body.author : "",
    notes,
  });

  // Meter BEFORE spending, at the worst-case price, so the cap can only ever
  // overcount mid-flight. The estimate uses the same max_tokens we send, so
  // the model cannot generate its way past what we already charged.
  const inputTokens = approxTokens(QUIZ_SYSTEM_PROMPT) + approxTokens(userMessage);
  const estimate = estimateCostUsd(inputTokens, QUIZ_MAX_OUTPUT_TOKENS);

  let spent: number;
  try {
    spent = await fetchAiSpendUsed();
  } catch (e) {
    // Fail closed: an unreadable meter disables spending rather than uncapping
    // it — the same invariant lib/aqua.ts enforces for dictation.
    const unconfigured = e instanceof AiUsageUnavailableError;
    console.error("quiz-generate: meter unreadable —", e);
    return NextResponse.json(
      { error: unconfigured ? "AI metering is not configured" : "Could not read the AI budget" },
      { status: unconfigured ? 501 : 503 },
    );
  }

  if (wouldExceedCap(spent, estimate)) {
    return NextResponse.json(
      { error: "This month's shared AI budget is used up." },
      { status: 429 },
    );
  }

  try {
    await addAiSpendUsed(estimate);
  } catch (e) {
    console.error("quiz-generate: could not record spend —", e);
    return NextResponse.json({ error: "Could not record AI usage" }, { status: 503 });
  }

  /** Give back what we over-charged. Also the failure path: if the call never
   *  billed, the whole estimate comes back. */
  const refund = async (amount: number) => {
    if (amount <= 0) return;
    try {
      await addAiSpendUsed(-amount);
    } catch (e) {
      // Losing a refund overcounts the budget, which is the safe direction —
      // log it, don't fail the user's request over it.
      console.error("quiz-generate: refund failed, budget will read high —", e);
    }
  };

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL_DEFAULT,
        max_tokens: QUIZ_MAX_OUTPUT_TOKENS,
        system: QUIZ_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: QUIZ_SCHEMA },
        },
      }),
    });
  } catch (e) {
    await refund(estimate); // never reached the vendor, so nothing was billed
    console.error("quiz-generate: request failed —", e);
    return NextResponse.json({ error: "Could not reach the AI service" }, { status: 502 });
  }

  if (!res.ok) {
    await refund(estimate); // rejected before generation — unbilled
    const detail = await res.text().catch(() => "");
    console.error(`quiz-generate: AI error ${res.status} ${detail.slice(0, 300)}`);
    return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 502 });
  }

  const data = (await res.json().catch(() => null)) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  } | null;

  // Reconcile to the real cost now that usage is known. This is always a
  // downward adjustment, by construction of the estimate above.
  const actual = costFromUsage({
    inputTokens: data?.usage?.input_tokens,
    outputTokens: data?.usage?.output_tokens,
    cacheWriteTokens: data?.usage?.cache_creation_input_tokens,
    cacheReadTokens: data?.usage?.cache_read_input_tokens,
  });
  await refund(estimate - actual);

  if (data?.stop_reason === "refusal") {
    return NextResponse.json({ error: "The AI declined this request." }, { status: 422 });
  }

  const text = data?.content?.find((b) => b.type === "text")?.text ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("quiz-generate: response was not JSON despite structured outputs");
  }

  const cards = parseQuizResponse(parsed);
  if (cards.length === 0) {
    return NextResponse.json({ error: "No usable cards came back. Try again." }, { status: 422 });
  }

  return NextResponse.json({ cards, costUsd: actual });
}
