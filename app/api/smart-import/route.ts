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
  SMART_IMPORT_MAX_CHARS,
  SMART_IMPORT_MAX_OUTPUT_TOKENS,
  SMART_IMPORT_MAX_ROUNDS,
  SMART_IMPORT_SCHEMA,
  SMART_IMPORT_SYSTEM_PROMPT,
  buildSmartImportMessage,
  parseSmartImportResponse,
  type SmartImportAnswer,
} from "@/lib/smartImport";

export const runtime = "nodejs";
// An LLM call can run far longer than the edge runtime allows to respond, and
// blowing that limit returns the platform error page instead of our JSON.
export const maxDuration = 300;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function parseAnswers(raw: unknown): SmartImportAnswer[] {
  if (!Array.isArray(raw)) return [];
  const answers: SmartImportAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { question, answer } = item as Record<string, unknown>;
    if (typeof question !== "string" || typeof answer !== "string") continue;
    if (!question.trim() || !answer.trim()) continue;
    answers.push({ question: question.trim(), answer: answer.trim() });
  }
  return answers;
}

export async function POST(req: NextRequest) {
  const guard = await guardAiRoute(req, "smart-import");
  if (!guard.ok) return guard.response;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 501 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const document = typeof body?.document === "string" ? body.document.trim() : "";
  const answers = parseAnswers(body?.answers);
  const round = typeof body?.round === "number" ? body.round : 0;
  const instructions = typeof body?.instructions === "string" ? body.instructions : "";

  if (!document) {
    return NextResponse.json({ error: "Paste a document first" }, { status: 400 });
  }
  if (document.length > SMART_IMPORT_MAX_CHARS) {
    // Refuse rather than truncate: silently dropping the back half of a
    // chapter loses notes the reader believes were captured.
    return NextResponse.json(
      {
        error: `That document is too long (${Math.round(
          document.length / 1000,
        )}k characters, limit ${SMART_IMPORT_MAX_CHARS / 1000}k). Import it a chapter at a time.`,
      },
      { status: 413 },
    );
  }

  const userMessage = buildSmartImportMessage(document, answers, instructions);
  const inputTokens = approxTokens(SMART_IMPORT_SYSTEM_PROMPT) + approxTokens(userMessage);
  const estimate = estimateCostUsd(inputTokens, SMART_IMPORT_MAX_OUTPUT_TOKENS);

  let spent: number;
  try {
    spent = await fetchAiSpendUsed();
  } catch (e) {
    const unconfigured = e instanceof AiUsageUnavailableError;
    console.error("smart-import: meter unreadable —", e);
    return NextResponse.json(
      { error: unconfigured ? "AI metering is not configured" : "Could not read the AI budget" },
      { status: unconfigured ? 501 : 503 },
    );
  }

  if (wouldExceedCap(spent, estimate)) {
    return NextResponse.json({ error: "This month's shared AI budget is used up." }, { status: 429 });
  }

  try {
    await addAiSpendUsed(estimate);
  } catch (e) {
    console.error("smart-import: could not record spend —", e);
    return NextResponse.json({ error: "Could not record AI usage" }, { status: 503 });
  }

  const refund = async (amount: number) => {
    if (amount <= 0) return;
    try {
      await addAiSpendUsed(-amount);
    } catch (e) {
      console.error("smart-import: refund failed, budget will read high —", e);
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
        max_tokens: SMART_IMPORT_MAX_OUTPUT_TOKENS,
        system: SMART_IMPORT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: SMART_IMPORT_SCHEMA },
        },
      }),
    });
  } catch (e) {
    await refund(estimate);
    console.error("smart-import: request failed —", e);
    return NextResponse.json({ error: "Could not reach the AI service" }, { status: 502 });
  }

  if (!res.ok) {
    await refund(estimate);
    const detail = await res.text().catch(() => "");
    console.error(`smart-import: AI error ${res.status} ${detail.slice(0, 300)}`);
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

  const actual = costFromUsage({
    inputTokens: data?.usage?.input_tokens,
    outputTokens: data?.usage?.output_tokens,
    cacheWriteTokens: data?.usage?.cache_creation_input_tokens,
    cacheReadTokens: data?.usage?.cache_read_input_tokens,
  });
  await refund(estimate - actual);

  if (data?.stop_reason === "refusal") {
    return NextResponse.json({ error: "The AI declined this document." }, { status: 422 });
  }
  if (data?.stop_reason === "max_tokens") {
    // A truncated structured response is unparseable JSON, and a half-imported
    // book is worse than none — say what actually happened.
    return NextResponse.json(
      { error: "The document produced more notes than one import can hold. Try a smaller section." },
      { status: 422 },
    );
  }

  const text = data?.content?.find((b) => b.type === "text")?.text ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("smart-import: response was not JSON despite structured outputs");
  }

  const result = parseSmartImportResponse(parsed);
  if (!result) {
    return NextResponse.json(
      { error: "Couldn't make notes out of that document." },
      { status: 422 },
    );
  }

  // The loop is capped, so a model that keeps asking can't stall the reader in
  // a question cycle. Past the cap it must commit to a best-effort parse.
  if (result.status === "questions" && round >= SMART_IMPORT_MAX_ROUNDS) {
    return NextResponse.json(
      { error: "Still unclear after a couple of rounds — try adding a note about the structure." },
      { status: 422 },
    );
  }

  return NextResponse.json({ ...result, costUsd: actual });
}
