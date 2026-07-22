import { NextResponse, type NextRequest } from "next/server";
import { guardAiRoute } from "@/lib/aiRouteGuard";
import { capabilitiesFor, serverPremiumUids } from "@/lib/capabilities";
import {
  AI_MODEL_DEEP,
  AI_MODEL_DEFAULT,
  approxTokens,
  costFromUsage,
  estimateCostUsd,
  wouldExceedCap,
} from "@/lib/ai";
import { AiUsageUnavailableError, addAiSpendUsed, fetchAiSpendUsed } from "@/lib/aiUsage";
import {
  ASK_MAX_INPUT_TOKENS,
  ASK_MAX_NOTES,
  ASK_MAX_OUTPUT_TOKENS,
  ASK_PERSONA_SUFFIX,
  ASK_SYSTEM_PROMPT,
  parseAnswer,
  serializeAskNotes,
  type AskSourceNote,
} from "@/lib/askPrompt";

export const runtime = "edge";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function parseNotes(raw: unknown): AskSourceNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: AskSourceNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, book, chapter, text } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof text !== "string" || !text.trim()) continue;
    notes.push({
      id,
      book: typeof book === "string" ? book : "",
      chapter: typeof chapter === "string" ? chapter : "",
      text: text.trim(),
    });
    if (notes.length >= ASK_MAX_NOTES) break;
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const notes = parseNotes(body?.notes);
  const lensType = typeof body?.lensType === "string" ? body.lensType : "";
  const persona = body?.persona === true;
  const wantsDeep = body?.deep === true;

  if (!question) return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
  if (notes.length === 0) {
    return NextResponse.json({ error: "That lens has no notes in it" }, { status: 400 });
  }

  const capabilities = capabilitiesFor(guard.user.uid, serverPremiumUids());

  // The whole-library lens is gated separately because it is by far the
  // priciest. Note this is a product gate, not a security boundary — the real
  // spend protections are the cap and the note/token limits below, which apply
  // whatever the client claims the lens is.
  if (lensType === "all" && !capabilities.has("lens:all")) {
    return NextResponse.json(
      { error: "The whole-library lens isn't enabled for this account" },
      { status: 403 },
    );
  }

  const deep = wantsDeep && capabilities.has("deep-answer");
  const system = ASK_SYSTEM_PROMPT + (persona ? ASK_PERSONA_SUFFIX : "");
  const notesBlock = serializeAskNotes(notes);

  const inputTokens = approxTokens(system) + approxTokens(notesBlock) + approxTokens(question);
  if (inputTokens > ASK_MAX_INPUT_TOKENS) {
    return NextResponse.json(
      { error: "That lens is too large for one question — narrow it down." },
      { status: 413 },
    );
  }

  const estimate = estimateCostUsd(inputTokens, ASK_MAX_OUTPUT_TOKENS, deep);

  let spent: number;
  try {
    spent = await fetchAiSpendUsed();
  } catch (e) {
    const unconfigured = e instanceof AiUsageUnavailableError;
    console.error("ask-notes: meter unreadable —", e);
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
    console.error("ask-notes: could not record spend —", e);
    return NextResponse.json({ error: "Could not record AI usage" }, { status: 503 });
  }

  const refund = async (amount: number) => {
    if (amount <= 0) return;
    try {
      await addAiSpendUsed(-amount);
    } catch (e) {
      console.error("ask-notes: refund failed, budget will read high —", e);
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
        model: deep ? AI_MODEL_DEEP : AI_MODEL_DEFAULT,
        max_tokens: ASK_MAX_OUTPUT_TOKENS,
        // Cache breakpoints sit on the two stable blocks — the instructions and
        // the lens's notes. The question goes last, uncached, so a follow-up
        // about the same lens re-reads the notes at ~10% of the input price
        // instead of paying for them again.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: notesBlock, cache_control: { type: "ephemeral" } },
              { type: "text", text: `Question: ${question}` },
            ],
          },
        ],
        output_config: { effort: "medium" },
      }),
    });
  } catch (e) {
    await refund(estimate);
    console.error("ask-notes: request failed —", e);
    return NextResponse.json({ error: "Could not reach the AI service" }, { status: 502 });
  }

  if (!res.ok) {
    await refund(estimate);
    const detail = await res.text().catch(() => "");
    console.error(`ask-notes: AI error ${res.status} ${detail.slice(0, 300)}`);
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

  const actual = costFromUsage(
    {
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      cacheWriteTokens: data?.usage?.cache_creation_input_tokens,
      cacheReadTokens: data?.usage?.cache_read_input_tokens,
    },
    deep,
  );
  await refund(estimate - actual);

  if (data?.stop_reason === "refusal") {
    return NextResponse.json({ error: "The AI declined this question." }, { status: 422 });
  }

  const text = data?.content?.find((b) => b.type === "text")?.text ?? "";
  if (!text.trim()) {
    return NextResponse.json({ error: "The AI returned nothing. Try again." }, { status: 422 });
  }

  const { answer, citations } = parseAnswer(text, notes);
  const cachedTokens = data?.usage?.cache_read_input_tokens ?? 0;
  return NextResponse.json({ answer, citations, costUsd: actual, cachedTokens, deep });
}
