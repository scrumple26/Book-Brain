import { describe, expect, it } from "vitest";
import {
  AI_HARD_STOP_USD,
  AI_MONTHLY_CAP_USD,
  aiMonthKey,
  aiUsageFraction,
  approxTokens,
  costFromUsage,
  estimateCostUsd,
  wouldExceedCap,
} from "./ai";
import { capabilitiesFor, hasCapability, parseUidList } from "./capabilities";

describe("costFromUsage", () => {
  it("prices each token class at its own rate", () => {
    // 1M input @ $3 + 1M output @ $15 + 1M cache-write @ $3.75 + 1M cache-read @ $0.30
    const cost = costFromUsage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(22.05, 6);
  });

  it("prices a realistic quiz generation at about two cents", () => {
    expect(costFromUsage({ inputTokens: 4600, outputTokens: 500 })).toBeCloseTo(0.0213, 4);
  });

  it("costs more per token on the deep (Opus) tier", () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000 };
    expect(costFromUsage(usage, true)).toBeGreaterThan(costFromUsage(usage, false));
  });

  it("treats missing and negative token counts as zero", () => {
    expect(costFromUsage({})).toBe(0);
    expect(costFromUsage({ inputTokens: -5_000_000 })).toBe(0);
  });
});

describe("estimateCostUsd", () => {
  it("over-charges relative to the true cost, never under", () => {
    // The invariant that keeps the cap honest: the pre-call estimate prices
    // input at the cache-WRITE rate and assumes a generous output length, so
    // reconciliation is always a refund.
    const inputTokens = 30_000;
    const estimate = estimateCostUsd(inputTokens);
    const actual = costFromUsage({ inputTokens, outputTokens: 700 });
    expect(estimate).toBeGreaterThan(actual);
  });

  it("still over-charges when the real call hits the cache", () => {
    const inputTokens = 30_000;
    const cached = costFromUsage({ cacheReadTokens: inputTokens, outputTokens: 700 });
    expect(estimateCostUsd(inputTokens)).toBeGreaterThan(cached);
  });

  it("covers a response that runs all the way to max_tokens", () => {
    // The invariant that makes the cap safe: callers pass the same max_tokens
    // they send, so the model cannot generate past what was already charged.
    // Equality at the ceiling is the worst case, and it must not be exceeded.
    const inputTokens = 5_000;
    const maxOutput = 2_000;
    const estimate = estimateCostUsd(inputTokens, maxOutput);
    const worstCase = costFromUsage({ inputTokens, outputTokens: maxOutput });
    expect(estimate).toBeGreaterThanOrEqual(worstCase);
  });
});

describe("wouldExceedCap", () => {
  it("stops at the hard stop, which sits below the headline cap", () => {
    expect(AI_HARD_STOP_USD).toBeLessThan(AI_MONTHLY_CAP_USD);
    expect(wouldExceedCap(AI_HARD_STOP_USD - 0.01, 0.005)).toBe(false);
    expect(wouldExceedCap(AI_HARD_STOP_USD - 0.01, 0.5)).toBe(true);
  });

  it("blocks everything once the hard stop is already reached", () => {
    expect(wouldExceedCap(AI_HARD_STOP_USD, 0.0001)).toBe(true);
  });
});

describe("aiUsageFraction", () => {
  it("is a 0-1 fraction of the headline cap for the progress bar", () => {
    expect(aiUsageFraction(0)).toBe(0);
    expect(aiUsageFraction(5)).toBeCloseTo(0.5, 6);
    expect(aiUsageFraction(AI_MONTHLY_CAP_USD)).toBe(1);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(aiUsageFraction(999)).toBe(1);
    expect(aiUsageFraction(-3)).toBe(0);
  });
});

describe("aiMonthKey", () => {
  it("buckets spend by calendar month", () => {
    expect(aiMonthKey(new Date("2026-07-22T18:00:00Z"))).toBe("2026-07");
    expect(aiMonthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});

describe("approxTokens", () => {
  it("estimates roughly four characters per token", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});

describe("capabilities", () => {
  const premium = ["admin-uid"];

  it("grants the full set to a premium uid", () => {
    expect(capabilitiesFor("admin-uid", premium).has("hub")).toBe(true);
    expect(hasCapability("admin-uid", premium, "lens:all")).toBe(true);
    expect(hasCapability("admin-uid", premium, "smart-import")).toBe(true);
  });

  it("grants nothing to a signed-in non-premium uid", () => {
    expect(capabilitiesFor("someone-else", premium).size).toBe(0);
    expect(hasCapability("someone-else", premium, "hub")).toBe(false);
  });

  it("fails CLOSED when the premium list is unset", () => {
    // Deliberately unlike AQUA_ALLOWED_UIDS, where empty means "allow all":
    // a missing deploy-time variable must not hand everyone the shared budget.
    expect(capabilitiesFor("admin-uid", []).size).toBe(0);
    expect(capabilitiesFor(null, premium).size).toBe(0);
    expect(capabilitiesFor(undefined, []).size).toBe(0);
  });

  it("parses a comma-separated uid list, ignoring whitespace and blanks", () => {
    expect(parseUidList(" a , b ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseUidList(undefined)).toEqual([]);
    expect(parseUidList("")).toEqual([]);
  });
});
