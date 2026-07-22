"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";
import { type QuizDraft } from "@/lib/quizPrompt";
import { readJson } from "@/lib/apiResponse";
import { generateId } from "@/lib/storage";
import type { QuizCard } from "@/lib/types";


/**
 * Propose-then-review quiz generation.
 *
 * Drafts are NEVER written straight into the book. Every card is edited or
 * discarded by hand before it can enter the review queue — which keeps ten
 * mediocre cards from devaluing every future session, and keeps the act of
 * rephrasing a card (the generation effect) in the loop rather than turning
 * card-making into a passive click.
 */
export function QuizGenerator({ bookId }: { bookId: string }) {
  const { user } = useAuth();
  const { books, upsertBook } = useBooks();
  const book = books.find((b) => b.id === bookId);

  const [status, setStatus] = useState<"idle" | "working" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<QuizDraft[] | null>(null);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(0);

  if (!book) return null;

  const sourceNotes = book.chapters
    .filter((c) => !c.deleted)
    .flatMap((c) => c.notes.map((n) => ({ id: n.id, chapter: c.name, text: n.text })));

  async function generate() {
    if (!user || !book) return;
    setStatus("working");
    setError(null);
    setDrafts(null);
    setSaved(0);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/quiz-generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title: book.title, author: book.author, notes: sourceNotes }),
      });
      const result = await readJson<{ cards: QuizDraft[] }>(res);
      if (!result.ok || !result.data) {
        setError(result.error);
        return;
      }
      setDrafts(result.data.cards);
      setKept(new Set(result.data.cards.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  }

  function editDraft(index: number, patch: Partial<QuizDraft>) {
    setDrafts((prev) => prev?.map((d, i) => (i === index ? { ...d, ...patch } : d)) ?? prev);
  }

  async function saveKept() {
    if (!drafts || !book) return;
    setStatus("saving");
    const chosen = drafts.filter((_, i) => kept.has(i));
    const cards: QuizCard[] = chosen.map((d) => ({
      id: generateId(),
      question: d.question,
      answer: d.answer,
      ...(d.sourceNoteId ? { sourceNoteId: d.sourceNoteId } : {}),
      aiGenerated: true,
      // No dueDate: a new card is due immediately, same as a manual one.
    }));
    try {
      await upsertBook({ ...book, quizCards: [...(book.quizCards ?? []), ...cards] });
      setSaved(cards.length);
      setDrafts(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="bg-white border border-parchment-200 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif font-semibold text-ink-900">Generate quiz cards</h2>
          <p className="text-xs text-ink-300 mt-0.5">
            Drafts from {sourceNotes.length} note{sourceNotes.length === 1 ? "" : "s"} — you review
            each one before anything is saved.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={status !== "idle" || sourceNotes.length === 0}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {status === "working" ? "Thinking…" : "✨ Generate"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      {saved > 0 && (
        <p className="text-sm text-ink-700 mt-3">
          Saved {saved} card{saved === 1 ? "" : "s"} to {book.title}. They&apos;re due now.
        </p>
      )}

      {drafts && (
        <div className="mt-4 flex flex-col gap-3">
          {drafts.map((draft, i) => (
            <div
              key={i}
              className={`border rounded-lg p-3 transition-colors ${
                kept.has(i) ? "border-parchment-300 bg-parchment-50" : "border-parchment-200 opacity-50"
              }`}
            >
              <input
                value={draft.question}
                onChange={(e) => editDraft(i, { question: e.target.value })}
                className="w-full bg-transparent font-medium text-ink-900 text-sm focus:outline-none"
                aria-label={`Question ${i + 1}`}
              />
              <textarea
                value={draft.answer}
                onChange={(e) => editDraft(i, { answer: e.target.value })}
                rows={2}
                className="w-full bg-transparent text-sm text-ink-500 mt-1 resize-none focus:outline-none"
                aria-label={`Answer ${i + 1}`}
              />
              <button
                onClick={() =>
                  setKept((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                className="text-xs text-ink-300 hover:text-amber-600 transition-colors"
              >
                {kept.has(i) ? "Discard" : "Keep"}
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button
              onClick={saveKept}
              disabled={kept.size === 0 || status === "saving"}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {status === "saving" ? "Saving…" : `Save ${kept.size} card${kept.size === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => setDrafts(null)}
              className="text-sm text-ink-500 hover:text-ink-700 transition-colors"
            >
              Discard all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
