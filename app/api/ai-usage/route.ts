import { NextResponse, type NextRequest } from "next/server";
import { guardAiRoute } from "@/lib/aiRouteGuard";
import { AI_HARD_STOP_USD, AI_MONTHLY_CAP_USD, aiMonthKey } from "@/lib/ai";
import { AiUsageUnavailableError, fetchAiSpendUsed } from "@/lib/aiUsage";

export const runtime = "edge";

/**
 * Read the shared AI budget, for the profile page's progress bar.
 *
 * This route exists because the counter is deliberately unreadable by clients
 * — locking the document in Firestore rules is what makes a shared budget
 * tamper-resistant, and the cost of that is the UI needs a server to ask.
 */
export async function GET(req: NextRequest) {
  const guard = await guardAiRoute(req, "hub");
  if (!guard.ok) return guard.response;

  try {
    const spendUsd = await fetchAiSpendUsed();
    return NextResponse.json({
      spendUsd,
      capUsd: AI_MONTHLY_CAP_USD,
      hardStopUsd: AI_HARD_STOP_USD,
      month: aiMonthKey(),
    });
  } catch (e) {
    // Fail closed and say so plainly: a usage bar that renders 0 when the
    // meter is unreachable is worse than one that admits it doesn't know,
    // because it reads as "plenty of budget left".
    const unconfigured = e instanceof AiUsageUnavailableError;
    console.error("ai-usage: could not read shared meter —", e);
    return NextResponse.json(
      { error: unconfigured ? "AI usage metering is not configured" : "Could not read AI usage" },
      { status: unconfigured ? 501 : 503 },
    );
  }
}
