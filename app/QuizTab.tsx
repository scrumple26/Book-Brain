"use client";

import { useState } from "react";
import Link from "next/link";
import { useBooks } from "@/context/BooksContext";
import { useCapabilities } from "@/lib/useCapabilities";
import { isDue } from "@/lib/srs";
import { QuizGenerator } from "@/app/BookQuizGenerator";

/**
 * Quiz — one place for the cards themselves.
 *
 * Reviewing is driven from the banner above this; here you see which books
 * actually have cards, and draft more for the ones that don't. Generation is
 * per-book because cards come from a single book's notes.
 */
export function QuizTab() {
  const { books } = useBooks();
  const capabilities = useCapabilities();
  const [bookId, setBookId] = useState("");

  const withCards = books
    .map((b) => ({
      book: b,
      total: b.quizCards?.length ?? 0,
      // Wrapped rather than passed by reference: isDue's second parameter is a
      // date string, which filter would fill with the array index.
      due: (b.quizCards ?? []).filter((c) => isDue(c)).length,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.due - a.due || b.total - a.total);

  const selected = bookId || books[0]?.id || "";

  return (
    <div className="flex flex-col gap-4">
      {withCards.length > 0 && (
        <div className="bg-white border border-parchment-200 rounded-xl p-5">
          <h2 className="font-serif font-semibold text-ink-900 mb-2">Cards by book</h2>
          <ul className="divide-y divide-parchment-100">
            {withCards.map(({ book, total, due }) => (
              <li key={book.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/book/${book.id}`} className="truncate text-ink-700 hover:text-amber-600 transition-colors">
                  {book.title}
                </Link>
                <span className="flex-shrink-0 text-xs text-ink-300">
                  {total} card{total === 1 ? "" : "s"}
                  {due > 0 && <span className="text-amber-600 font-medium"> · {due} due</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {capabilities.has("hub") && books.length > 0 && (
        <>
          <div className="bg-white border border-parchment-200 rounded-xl p-5">
            <label className="block text-sm text-ink-700 mb-2">Draft cards from a book</label>
            <select
              value={selected}
              onChange={(e) => setBookId(e.target.value)}
              className="w-full max-w-sm border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
          </div>
          <QuizGenerator bookId={selected} />
        </>
      )}

      {withCards.length === 0 && !capabilities.has("hub") && (
        <p className="text-sm text-ink-300">
          No cards yet — open a book and add some from its Quiz panel.
        </p>
      )}
    </div>
  );
}
