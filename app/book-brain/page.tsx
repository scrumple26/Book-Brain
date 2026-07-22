"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";
import { useCapabilities } from "@/lib/useCapabilities";
import {
  lensLabel,
  lensSize,
  libraryAuthors,
  libraryTags,
  resolveLens,
  type Lens,
  type LensMatch,
} from "@/lib/lens";
import type { AskCitation } from "@/lib/askPrompt";
import { readJson } from "@/lib/apiResponse";
import { estimateCostUsd } from "@/lib/ai";
import { QUIZ_MAX_OUTPUT_TOKENS } from "@/lib/quizPrompt";
import { QuizGenerator } from "@/app/BookQuizGenerator";

type LensKind = Lens["type"];
type HubTab = "ask" | "quiz";

const TAB_LABELS: Record<HubTab, string> = {
  ask: "Ask your notes",
  quiz: "Quiz cards",
};

const KIND_LABELS: Record<LensKind, string> = {
  book: "A book",
  tag: "A tag",
  author: "An author",
  all: "Entire library",
};

/**
 * The Book Brain hub — the home for every AI feature.
 *
 * This is the Phase 0 shell: the lens picker works and shows exactly what a
 * question would read and roughly what it would cost, but nothing is sent
 * anywhere yet. Shipping the scope picker before the spending is deliberate —
 * it makes the retrieval layer verifiable against a real library while the
 * cost of being wrong is still zero.
 */
export default function BookBrainPage() {
  const { user, loading: authLoading } = useAuth();
  const { books, loading: booksLoading } = useBooks();
  const capabilities = useCapabilities();

  const [tab, setTab] = useState<HubTab>("ask");
  const [kind, setKind] = useState<LensKind>("all");
  const [bookId, setBookId] = useState("");
  const [tag, setTag] = useState("");
  const [author, setAuthor] = useState("");

  const tags = useMemo(() => libraryTags(books), [books]);
  const authors = useMemo(() => libraryAuthors(books), [books]);

  const lens: Lens = useMemo(() => {
    switch (kind) {
      case "book":
        return { type: "book", bookId: bookId || books[0]?.id || "" };
      case "tag":
        return { type: "tag", tag: tag || tags[0] || "" };
      case "author":
        return { type: "author", author: author || authors[0] || "" };
      case "all":
        return { type: "all" };
    }
  }, [kind, bookId, tag, author, books, tags, authors]);

  const matches = useMemo(() => resolveLens(lens, books), [lens, books]);
  const size = useMemo(() => lensSize(matches), [matches]);
  const estimate = estimateCostUsd(size.tokens, QUIZ_MAX_OUTPUT_TOKENS);
  const allLocked = kind === "all" && !capabilities.has("lens:all");

  if (authLoading || booksLoading) {
    return <main className="max-w-3xl mx-auto px-6 py-16 text-ink-500">Loading…</main>;
  }

  if (!user || !capabilities.has("hub")) {
    return (
      <div className="min-h-screen bg-parchment-50">
        <Header />
        <main className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-4xl mb-3">🧠</p>
          <h2 className="font-serif text-2xl text-ink-900 mb-2">Book Brain is a premium feature</h2>
          <p className="text-ink-500">
            Ask questions across your notes, generate quiz cards from what you&apos;ve captured, and
            turn documents into book notes.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-parchment-50">
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex flex-wrap gap-1.5 mb-6 border-b border-parchment-300 pb-3">
          {(Object.keys(TAB_LABELS) as HubTab[])
            .map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  tab === t
                    ? "bg-amber-600 text-white"
                    : "text-ink-500 hover:bg-amber-50 hover:text-amber-600"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
        </div>

        {tab === "quiz" && <QuizTab />}

        {tab === "ask" && (
          <>
        <p className="text-ink-500 mb-6">
          Choose a lens — the set of notes a question is allowed to read — then ask.
        </p>

        <div className="bg-white border border-parchment-200 rounded-xl p-5 mb-4">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(Object.keys(KIND_LABELS) as LensKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  kind === k
                    ? "bg-amber-600 border-amber-600 text-white"
                    : "bg-white border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600"
                }`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          {kind === "book" && (
            <LensSelect value={bookId || books[0]?.id || ""} onChange={setBookId} empty="No books yet">
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </LensSelect>
          )}
          {kind === "tag" && (
            <LensSelect value={tag || tags[0] || ""} onChange={setTag} empty="No tags yet">
              {tags.map((t) => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </LensSelect>
          )}
          {kind === "author" && (
            <LensSelect value={author || authors[0] || ""} onChange={setAuthor} empty="No authors yet">
              {authors.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </LensSelect>
          )}

          <p className="text-sm text-ink-700 mt-4">
            <span className="font-medium">{lensLabel(lens, books)}</span> ·{" "}
            {size.notes.toLocaleString()} note{size.notes === 1 ? "" : "s"} from {size.books} book
            {size.books === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-ink-300 mt-0.5">
            ≈{size.tokens.toLocaleString()} tokens · about ${estimate.toFixed(2)} per question
            {kind === "all" && " — the whole library is the priciest lens"}
          </p>
          {allLocked && (
            <p className="text-xs text-amber-700 mt-2">
              The whole-library lens is a premium add-on and isn&apos;t enabled for this account.
            </p>
          )}
        </div>

        <Asker lens={lens} matches={matches} disabled={allLocked} />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Ask a question of whatever the current lens can see.
 *
 * Every answer ships with the notes it leaned on. That trace is the trust
 * mechanism: without it the reader has no way to tell a synthesis of their own
 * thinking from something the model filled in, which is exactly the failure
 * this feature has to avoid.
 */
function Asker({
  lens,
  matches,
  disabled,
}: {
  lens: Lens;
  matches: LensMatch[];
  disabled: boolean;
}) {
  const { user } = useAuth();
  const capabilities = useCapabilities();
  const [question, setQuestion] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    answer: string;
    citations: AskCitation[];
    cachedTokens: number;
  } | null>(null);

  async function ask() {
    if (!user || !question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/ask-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          question,
          lensType: lens.type,
          deep,
          notes: matches.map((m) => ({
            id: m.note.id,
            book: m.book.title,
            chapter: m.chapter.name,
            text: m.note.text,
          })),
        }),
      });
      const parsed = await readJson<{
        answer: string;
        citations: AskCitation[];
        cachedTokens: number;
      }>(res);
      if (!parsed.ok || !parsed.data) {
        setError(parsed.error);
        return;
      }
      setResult(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-parchment-200 rounded-xl p-5">
      <h2 className="font-serif font-semibold text-ink-900 mb-3">Ask your notes</h2>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        placeholder="What do my notes say about…?"
        className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
      />

      <div className="flex flex-wrap items-center gap-4 mt-3">
        <button
          onClick={ask}
          disabled={busy || disabled || !question.trim() || matches.length === 0}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {busy ? "Reading…" : "Ask"}
        </button>

        {capabilities.has("deep-answer") && (
          <label className="flex items-center gap-2 text-xs text-ink-500 cursor-pointer">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
            Deep answer <span className="text-ink-300">(pricier)</span>
          </label>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {result && (
        <div className="mt-4 border-t border-parchment-200 pt-4">
          <div className="text-sm text-ink-900 whitespace-pre-wrap leading-relaxed">
            {result.answer}
          </div>

          {result.citations.length > 0 && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-ink-300 mb-2">
                From {result.citations.length} note{result.citations.length === 1 ? "" : "s"}
              </p>
              <ul className="flex flex-col gap-2">
                {result.citations.map((c) => (
                  <li key={c.id} className="border-l-2 border-amber-300 pl-3">
                    <p className="text-sm text-ink-700">{c.text}</p>
                    <p className="text-xs text-ink-300">
                      {c.book}
                      {c.chapter ? ` · ${c.chapter}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.cachedTokens > 0 && (
            <p className="text-xs text-ink-300 mt-3">
              Reused {result.cachedTokens.toLocaleString()} cached tokens — follow-ups on this lens
              are cheaper.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Quiz generation is per-book, so this tab picks a book rather than a lens. */
function QuizTab() {
  const { books } = useBooks();
  const [bookId, setBookId] = useState("");
  const selected = bookId || books[0]?.id || "";

  if (books.length === 0) {
    return (
      <p className="text-ink-500 text-sm">
        Add a book first — quiz cards are generated from a book&apos;s own notes.
      </p>
    );
  }

  return (
    <>
      <div className="bg-white border border-parchment-200 rounded-xl p-5 mb-4">
        <label className="block text-sm text-ink-700 mb-2">Book</label>
        <LensSelect value={selected} onChange={setBookId} empty="No books yet">
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </LensSelect>
      </div>
      <QuizGenerator bookId={selected} />
    </>
  );
}

function Header() {
  return (
    <header className="border-b border-parchment-300 bg-parchment-100 px-6 py-5">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <Link href="/" className="text-sm text-ink-500 hover:text-amber-600 transition-colors">
          ← Library
        </Link>
        <h1 className="text-lg font-semibold text-ink-900">🧠 Book Brain</h1>
      </div>
    </header>
  );
}

function LensSelect({
  value,
  onChange,
  empty,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  empty: string;
  children: React.ReactNode;
}) {
  const options = Array.isArray(children) ? children : [children];
  if (options.flat().length === 0) {
    return <p className="text-sm text-ink-300">{empty}</p>;
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full max-w-sm border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
    >
      {children}
    </select>
  );
}
