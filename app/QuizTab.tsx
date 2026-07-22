"use client";

import { useState } from "react";
import Link from "next/link";
import { useBooks } from "@/context/BooksContext";
import { useCapabilities } from "@/lib/useCapabilities";
import { isDue } from "@/lib/srs";
import type { Book, QuizCard } from "@/lib/types";
import { QuizGenerator } from "@/app/BookQuizGenerator";

export interface ReviewItem {
  bookId: string;
  card: QuizCard;
}

/**
 * Quiz — one place for the cards themselves.
 *
 * Review what is due, review a single book, or review everything — the due
 * queue is the habit, but cramming one book before you discuss it is a real
 * need too. Drafting is per-book because cards come from one book's notes.
 */
export function QuizTab({ onStartReview }: { onStartReview: (cards: ReviewItem[]) => void }) {
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

  // Alphabetical, so a title is findable by name rather than by shelf order.
  const sortedBooks = [...books].sort((a, b) => a.title.localeCompare(b.title));
  const selected = bookId || sortedBooks[0]?.id || "";

  const cardsOf = (book: Book, dueOnly: boolean): ReviewItem[] =>
    (book.quizCards ?? [])
      .filter((c) => !dueOnly || isDue(c))
      .map((card) => ({ bookId: book.id, card }));

  const everyCard = withCards.flatMap(({ book }) => cardsOf(book, false));

  return (
    <div className="flex flex-col gap-4">
      {withCards.length > 0 && (
        <div className="bg-white border border-parchment-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h2 className="font-serif font-semibold text-ink-900">Cards by book</h2>
            <button
              onClick={() => onStartReview(everyCard)}
              className="border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Review all {everyCard.length}
            </button>
          </div>
          <ul className="divide-y divide-parchment-100">
            {withCards.map(({ book, total, due }) => (
              <li key={book.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/book/${book.id}`} className="truncate text-ink-700 hover:text-amber-600 transition-colors">
                  {book.title}
                </Link>
                <span className="flex flex-shrink-0 items-center gap-2 text-xs text-ink-300">
                  <span>
                    {total} card{total === 1 ? "" : "s"}
                    {due > 0 && <span className="text-amber-600 font-medium"> · {due} due</span>}
                  </span>
                  {/* Reviewing what's due is the habit; reviewing everything is
                      for cramming a book you're about to discuss. Offer both,
                      but lead with due when there is any. */}
                  {due > 0 && (
                    <button
                      onClick={() => onStartReview(cardsOf(book, true))}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-2.5 py-1 rounded-md transition-colors"
                    >
                      Review {due}
                    </button>
                  )}
                  <button
                    onClick={() => onStartReview(cardsOf(book, false))}
                    className="border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 font-medium px-2.5 py-1 rounded-md transition-colors"
                  >
                    All
                  </button>
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
              {sortedBooks.map((b) => (
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
