"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useCapabilities } from "@/lib/useCapabilities";
import {
  AQUA_MAX_SECONDS_PER_MONTH,
  AQUA_MONTHLY_CAP_USD,
  aquaSpendUsd,
  fetchAquaSecondsUsed,
} from "@/lib/aqua";
import { AI_MONTHLY_CAP_USD, aiUsageFraction } from "@/lib/ai";

type Loadable<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; value: T };

const HOURS_PER_MONTH = AQUA_MAX_SECONDS_PER_MONTH / 3600;

function UsageBar({
  label,
  note,
  fraction,
  detail,
}: {
  label: string;
  note: string;
  fraction: number;
  detail: string;
}) {
  const pct = Math.round(fraction * 100);
  // Amber until it's getting tight, red once the budget is nearly gone — the
  // bar should communicate "you're about to lose the feature" before it happens.
  const fill = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-amber-600";

  return (
    <div className="bg-white border border-parchment-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="font-serif font-semibold text-ink-900">{label}</h2>
        <span className="text-sm text-ink-500">{pct}%</span>
      </div>
      <p className="text-xs text-ink-300 mb-3">{note}</p>
      <div
        className="h-2 w-full rounded-full bg-parchment-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-ink-700 mt-2">{detail}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const capabilities = useCapabilities();
  const [voice, setVoice] = useState<Loadable<number>>({ state: "loading" });
  const [ai, setAi] = useState<Loadable<{ spendUsd: number; capUsd: number }>>({ state: "loading" });

  // Voice is metered per-user, so it reads straight from that user's own doc.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchAquaSecondsUsed(user.uid)
      .then((seconds) => { if (!cancelled) setVoice({ state: "ok", value: seconds }); })
      .catch((err) => {
        if (!cancelled) setVoice({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [user]);

  // AI is a shared pool behind a locked document, so it has to come from the
  // server — the client has no read access to the counter by design.
  useEffect(() => {
    if (!user || !capabilities.has("hub")) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/ai-usage", { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setAi({ state: "error", message: body?.error ?? `Request failed (${res.status})` });
          return;
        }
        setAi({ state: "ok", value: { spendUsd: body.spendUsd, capUsd: body.capUsd } });
      } catch (err) {
        if (!cancelled) setAi({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [user, capabilities]);

  if (loading) return <main className="max-w-3xl mx-auto px-6 py-16 text-ink-500">Loading…</main>;
  if (!user) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-ink-500">
          <Link href="/" className="text-amber-600 hover:underline">Sign in</Link> to see your profile.
        </p>
      </main>
    );
  }

  const voiceHoursUsed = voice.state === "ok" ? voice.value / 3600 : 0;

  return (
    <div className="min-h-screen bg-parchment-50">
      <header className="border-b border-parchment-300 bg-parchment-100 px-6 py-5">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-sm text-ink-500 hover:text-amber-600 transition-colors">
            ← Library
          </Link>
          <h1 className="text-lg font-semibold text-ink-900">Profile</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <section className="flex items-center gap-4 mb-8">
          {user.photoURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" className="w-14 h-14 rounded-full" />
          )}
          <div>
            <p className="font-serif text-xl text-ink-900">{user.displayName ?? "Reader"}</p>
            <p className="text-sm text-ink-500">{user.email}</p>
            {capabilities.has("hub") && (
              <span className="inline-block mt-1 bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
                Premium
              </span>
            )}
          </div>
        </section>

        <h2 className="font-serif text-lg text-ink-900 mb-3">This month&apos;s usage</h2>
        <div className="flex flex-col gap-4">
          {voice.state === "error" ? (
            <div className="bg-white border border-parchment-200 rounded-xl p-5">
              <h2 className="font-serif font-semibold text-ink-900">Voice dictation</h2>
              <p className="text-sm text-red-600 mt-1">Couldn&apos;t read your usage: {voice.message}</p>
            </div>
          ) : (
            <UsageBar
              label="Voice dictation"
              note="Your own allowance — high-accuracy transcription."
              fraction={voice.state === "ok" ? voice.value / AQUA_MAX_SECONDS_PER_MONTH : 0}
              detail={
                voice.state === "loading"
                  ? "Loading…"
                  : `${voiceHoursUsed.toFixed(1)} of ${HOURS_PER_MONTH.toFixed(1)} hours · $${aquaSpendUsd(
                      voice.value,
                    ).toFixed(2)} of $${AQUA_MONTHLY_CAP_USD}.00`
              }
            />
          )}

          {!capabilities.has("hub") ? (
            <div className="bg-white border border-parchment-200 rounded-xl p-5">
              <h2 className="font-serif font-semibold text-ink-900">Book Brain AI</h2>
              <p className="text-sm text-ink-500 mt-1">
                A premium feature. Ask questions across your notes, generate quiz cards, and import
                documents with AI.
              </p>
            </div>
          ) : ai.state === "error" ? (
            <div className="bg-white border border-parchment-200 rounded-xl p-5">
              <h2 className="font-serif font-semibold text-ink-900">Book Brain AI</h2>
              <p className="text-sm text-red-600 mt-1">Couldn&apos;t read the AI budget: {ai.message}</p>
              <p className="text-xs text-ink-300 mt-1">
                AI features stay disabled while the meter is unreadable.
              </p>
            </div>
          ) : (
            <UsageBar
              label="Book Brain AI"
              // Stated plainly: this bar moves when ANY account spends, so a
              // shift the user didn't cause reads as shared, not as a bug.
              note="Shared across all accounts — not a personal allowance."
              fraction={ai.state === "ok" ? aiUsageFraction(ai.value.spendUsd) : 0}
              detail={
                ai.state === "loading"
                  ? "Loading…"
                  : `$${ai.value.spendUsd.toFixed(2)} of $${ai.value.capUsd.toFixed(2)} used`
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
