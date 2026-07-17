"use client";

export const dynamic = "force-dynamic";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Book } from "@/lib/types";
import { generateId } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";
import { parseBooks, toBook, countNotes, type ParsedBook } from "@/lib/importBook";

function SignInScreen({ onSignIn, error }: { onSignIn: () => void; error: string | null }) {
  return (
    <div className="min-h-screen bg-parchment-50 flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <p className="text-5xl mb-6">📖</p>
        <h1 className="font-serif text-3xl font-semibold text-ink-900 mb-2">Book Brain</h1>
        <p className="text-ink-500 text-sm mb-8">
          Your personal book notes library. Sign in to get started.
        </p>
        {error && (
          <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-left break-words">
            {error}
          </p>
        )}
        <button
          onClick={onSignIn}
          className="inline-flex items-center gap-3 bg-white border border-parchment-300 hover:border-amber-500 hover:shadow-md text-ink-800 text-sm font-medium px-6 py-3 rounded-xl transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag() {
    const val = input.trim().toLowerCase();
    if (!val || tags.includes(val)) { setInput(""); return; }
    onChange([...tags, val]);
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-[42px] w-full border border-parchment-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-amber-500 focus-within:border-transparent cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
          {tag}
          <button type="button" onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="hover:text-amber-900 leading-none">×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? "Add tags… (Enter or comma)" : ""}
        className="flex-1 min-w-[80px] text-sm text-ink-900 placeholder-ink-300 outline-none bg-transparent"
      />
    </div>
  );
}

export default function Library() {
  const router = useRouter();
  const { user, loading, signInError, signIn, signOut } = useAuth();
  const { books, loading: booksLoading, error: booksError, upsertBook, removeBook } = useBooks();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [dateCompleted, setDateCompleted] = useState("");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Import: paste or upload a Markdown / CSV file → preview → save as books
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importName, setImportName] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const importPreview: ParsedBook[] = importText.trim() ? parseBooks(importText, importName) : [];

  function resetImport() {
    setImportText("");
    setImportName(undefined);
    setShowImport(false);
    if (importFileRef.current) importFileRef.current.value = "";
  }

  async function runImport() {
    if (!user || importPreview.length === 0 || importing) return;
    setImporting(true);
    try {
      for (const parsed of importPreview) {
        await upsertBook(toBook(parsed));
      }
      resetImport();
    } finally {
      setImporting(false);
    }
  }

  // Feature 7: Reading log
  const todayStr = new Date().toISOString().split("T")[0];
  const [logDate, setLogDate] = useState(todayStr);
  const [logPages, setLogPages] = useState("");
  const [logBookId, setLogBookId] = useState("");

  // Feature 6: Random notes — computed once after books first load
  const [randomNotes, setRandomNotes] = useState<{ text: string; bookTitle: string; chapterName: string; bold: boolean }[]>([]);
  const randomNotesPicked = useRef(false);
  function pickRandomNotes() {
    const pool: { text: string; bookTitle: string; chapterName: string; bold: boolean }[] = [];
    for (const b of books) {
      for (const c of b.chapters.filter((ch) => !ch.deleted)) {
        let mainBullet: string | null = null;
        for (const n of c.notes) {
          if ((n.indent ?? 0) === 0) mainBullet = n.text;
          const source = (n.indent ?? 0) > 0 && mainBullet !== null
            ? (mainBullet.length > 60 ? mainBullet.slice(0, 60) + "…" : mainBullet)
            : c.name;
          pool.push({ text: n.text, bookTitle: b.title, chapterName: source, bold: n.bold ?? false });
        }
      }
    }
    if (pool.length === 0) return false;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    setRandomNotes(shuffled.slice(0, 5));
    return true;
  }
  useEffect(() => {
    if (randomNotesPicked.current || booksLoading || books.length === 0) return;
    if (pickRandomNotes()) randomNotesPicked.current = true;
  }, [books, booksLoading]);

  function resetForm() {
    setTitle("");
    setAuthor("");
    setNewTags([]);
    setDateCompleted("");
    setShowForm(false);
  }

  async function addBook() {
    if (!user || !title.trim() || !author.trim()) return;
    const book: Book = {
      id: generateId(),
      title: title.trim(),
      author: author.trim(),
      tags: newTags,
      dateCompleted: dateCompleted || undefined,
      createdAt: new Date().toISOString(),
      chapters: [],
    };
    resetForm();
    await upsertBook(book);
  }

  async function handleDeleteBook(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this book and all its notes?")) return;
    await removeBook(id);
  }

  // Feature 7: Reading log submit
  async function addReadingLogEntry() {
    if (!logBookId || !logPages || !logDate) return;
    const pages = parseInt(logPages, 10);
    if (isNaN(pages) || pages <= 0) return;
    const targetBook = books.find((b) => b.id === logBookId);
    if (!targetBook) return;
    const entry = { date: logDate, pages };
    const updated: Book = { ...targetBook, readingLog: [...(targetBook.readingLog ?? []), entry] };
    setLogPages("");
    await upsertBook(updated);
  }

  // Feature 7: Stats derived from readingLog
  const currentYear = new Date().getFullYear().toString();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  let totalPagesThisMonth = 0;
  let totalPagesThisYear = 0;
  const recentLogEntries: { date: string; pages: number; bookTitle: string }[] = [];
  for (const b of books) {
    for (const e of b.readingLog ?? []) {
      if (e.date.startsWith(currentMonth)) totalPagesThisMonth += e.pages;
      if (e.date.startsWith(currentYear)) totalPagesThisYear += e.pages;
      recentLogEntries.push({ date: e.date, pages: e.pages, bookTitle: b.title });
    }
  }
  recentLogEntries.sort((a, b) => b.date.localeCompare(a.date));
  const last5Entries = recentLogEntries.slice(0, 5);

  // Feature 8: Books completed this year chart
  const completedThisYear = books.filter((b) => b.dateCompleted?.startsWith(currentYear));
  const monthCounts = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    return completedThisYear.filter((b) => b.dateCompleted?.startsWith(`${currentYear}-${mm}`)).length;
  });
  const maxMonthCount = Math.max(...monthCounts, 1);
  const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  // All unique tags across all books
  const allTags = Array.from(new Set(books.flatMap((b) => b.tags ?? []))).sort();

  const filtered = books.filter((b) => {
    const matchesSearch =
      !search ||
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.author.toLowerCase().includes(search.toLowerCase()) ||
      (b.tags ?? []).some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesTag = !activeTag || (b.tags ?? []).includes(activeTag);
    return matchesSearch && matchesTag;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-parchment-50 flex items-center justify-center">
        <p className="text-ink-300 text-sm">Loading…</p>
      </div>
    );
  }

  if (!user) return <SignInScreen onSignIn={signIn} error={signInError} />;

  return (
    <div className="min-h-screen bg-parchment-50">
      {/* Header */}
      <header className="border-b border-parchment-300 bg-parchment-100 px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📖</span>
            <h1 className="text-2xl font-semibold text-ink-900">Book Brain</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {user.photoURL && (
                <img src={user.photoURL} alt={user.displayName ?? ""} className="w-8 h-8 rounded-full" />
              )}
              <span className="text-sm text-ink-500 hidden sm:block">{user.displayName ?? user.email}</span>
            </div>
            <button
              onClick={signOut}
              className="text-xs text-ink-300 hover:text-ink-700 border border-parchment-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="Import notes from a Markdown or CSV file"
            >
              <span className="text-base leading-none">↑</span> Import
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <span className="text-base leading-none">+</span> Add Book
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Firestore error banner */}
        {booksError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            <strong>Database error:</strong> {booksError}
            <br />
            <span className="text-xs text-red-500">Check your Firestore security rules in the Firebase Console.</span>
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search titles, authors, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md bg-white border border-parchment-300 rounded-lg px-4 py-2.5 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>

        {/* Tag filter pills */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                  activeTag === tag
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white text-ink-500 border-parchment-300 hover:border-amber-500 hover:text-amber-600"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* ── Features 6 / 7 / 8 — three-column info cards ── */}
        {!booksLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

            {/* Feature 6: Random notes */}
            {randomNotes.length > 0 && (
              <div className="bg-white border border-parchment-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-ink-300 uppercase tracking-wide">📝 From Your Notes</p>
                  <button onClick={() => pickRandomNotes()} className="text-ink-300 hover:text-amber-600 transition-colors" title="Show different notes">↻</button>
                </div>
                <div className="space-y-3">
                  {randomNotes.map((n, i) => (
                    <div key={i} className="border-l-2 border-amber-300 pl-3">
                      <p className={`text-sm text-ink-800 leading-snug ${n.bold ? "font-bold" : ""}`}>{n.text}</p>
                      <p className="text-xs text-ink-300 mt-0.5 italic">— {n.bookTitle}, {n.chapterName}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Feature 7: Reading log */}
            <div className="bg-white border border-parchment-200 rounded-xl p-5">
              <p className="text-xs font-medium text-ink-300 uppercase tracking-wide mb-3">📖 Reading Log</p>
              <div className="flex gap-4 mb-3 text-sm">
                <div>
                  <span className="text-xs text-ink-300">This month</span>
                  <p className="font-semibold text-ink-900">{totalPagesThisMonth.toLocaleString()} pg</p>
                </div>
                <div>
                  <span className="text-xs text-ink-300">This year</span>
                  <p className="font-semibold text-ink-900">{totalPagesThisYear.toLocaleString()} pg</p>
                </div>
              </div>
              <div className="space-y-1.5 mb-3">
                <select
                  value={logBookId}
                  onChange={(e) => setLogBookId(e.target.value)}
                  className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                >
                  <option value="">Select book…</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>{b.title}</option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="flex-1 border border-parchment-300 rounded-lg px-2 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                  <input
                    type="number"
                    min="1"
                    value={logPages}
                    onChange={(e) => setLogPages(e.target.value)}
                    placeholder="Pages"
                    className="w-20 border border-parchment-300 rounded-lg px-2 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                  <button
                    onClick={addReadingLogEntry}
                    disabled={!logBookId || !logPages || !logDate}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                  >Add</button>
                </div>
              </div>
              {last5Entries.length > 0 && (
                <div className="space-y-1 border-t border-parchment-100 pt-2">
                  {last5Entries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-ink-500">
                      <span className="truncate mr-2">{e.bookTitle}</span>
                      <span className="flex-shrink-0 text-ink-300">{e.date} · {e.pages} pg</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Feature 8: Completed this year chart */}
            <div className="bg-white border border-parchment-200 rounded-xl p-5">
              <p className="text-xs font-medium text-ink-300 uppercase tracking-wide mb-1">📊 Completed This Year</p>
              {completedThisYear.length === 0 ? (
                <p className="text-ink-300 text-sm italic mt-4">No books completed in {currentYear} yet.</p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ink-900 mb-3">{completedThisYear.length} book{completedThisYear.length !== 1 ? "s" : ""} completed in {currentYear}</p>
                  <svg viewBox="0 0 240 80" className="w-full" aria-hidden="true">
                    {monthCounts.map((count, i) => {
                      const barH = count === 0 ? 2 : Math.max(4, Math.round((count / maxMonthCount) * 60));
                      const x = i * 20 + 4;
                      const y = 65 - barH;
                      return (
                        <g key={i}>
                          <rect x={x} y={y} width={12} height={barH} rx={2}
                            fill={count > 0 ? "#d97706" : "#fde68a"} />
                          <text x={x + 6} y={76} textAnchor="middle" fontSize="7" fill="#9ca3af">{MONTH_LABELS[i]}</text>
                        </g>
                      );
                    })}
                  </svg>
                </>
              )}
            </div>

          </div>
        )}

        {booksLoading ? (
          <div className="text-center py-24">
            <p className="text-ink-300 text-sm">Loading your library…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-5xl mb-4">📚</p>
            <p className="text-ink-500 text-lg font-serif italic">
              {search || activeTag ? "No books match your filter." : "Your library is empty."}
            </p>
            {!search && !activeTag && (
              <p className="text-ink-300 text-sm mt-2">Add your first book to get started.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((book) => (
              <div
                key={book.id}
                onClick={() => router.push(`/book/${book.id}`)}
                className="group bg-white border border-parchment-200 rounded-xl p-5 cursor-pointer hover:border-amber-500 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h2 className="font-serif font-semibold text-ink-900 text-lg leading-snug truncate">
                      {book.title}
                    </h2>
                    <p className="text-ink-500 text-sm mt-0.5 italic truncate">{book.author}</p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteBook(book.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-ink-300 hover:text-red-500 transition-all text-lg leading-none flex-shrink-0"
                  >
                    ×
                  </button>
                </div>

                {/* Tags */}
                {(book.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {(book.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        onClick={(e) => { e.stopPropagation(); setActiveTag(activeTag === tag ? null : tag); }}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                          activeTag === tag
                            ? "bg-amber-600 text-white"
                            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-parchment-200 flex items-center gap-3 text-xs text-ink-300">
                  <span>{book.chapters.length} chapter{book.chapters.length !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>
                    {book.chapters.reduce((acc, c) => acc + c.notes.length, 0)} note
                    {book.chapters.reduce((acc, c) => acc + c.notes.length, 0) !== 1 ? "s" : ""}
                  </span>
                  {book.dateCompleted && (
                    <>
                      <span>·</span>
                      <span className="text-amber-600 font-medium">
                        ✓ {new Date(book.dateCompleted + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Import modal */}
      {showImport && (
        <div
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={resetImport}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-semibold text-ink-900 mb-2">Import notes</h2>
            <p className="text-xs text-ink-500 mb-4 leading-relaxed">
              Paste a Markdown or CSV file, or choose one. Markdown: a title line (<code>{"# Title"}</code> or{" "}
              <code>{"**Title By Author**"}</code>), chapter headers (<code>{"## Name"}</code> or{" "}
              <code>{"**Chp 1: Name**"}</code>), and <code>*</code>/<code>-</code> bullets — indent sub-bullets with 2 spaces.
              CSV needs <code>Book</code> and <code>Note</code> columns (optional <code>Author</code>, <code>Chapter</code>, <code>Indent</code>).
            </p>

            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => importFileRef.current?.click()}
                className="border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                Choose file (.md / .csv)
              </button>
              {importName && <span className="text-xs text-ink-300 truncate">{importName}</span>}
              <input
                ref={importFileRef}
                type="file"
                accept=".md,.markdown,.csv,.txt,text/markdown,text/csv,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setImportName(file.name);
                  setImportText(await file.text());
                }}
              />
            </div>

            <textarea
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setImportName(undefined); }}
              rows={8}
              placeholder={"**The Art Of Winning By Bill Belichick**\n\n**Chp 1: Big Games**\n\n* A note…\n  * A sub-note…"}
              className="w-full border border-parchment-300 rounded-lg px-3 py-2.5 text-xs font-mono text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y"
            />

            {importText.trim() && (
              <div className="mt-3 rounded-lg bg-parchment-50 border border-parchment-200 px-3 py-2 text-sm">
                {importPreview.length === 0 ? (
                  <p className="text-red-500 text-xs">
                    Couldn&apos;t find any books. Check the title line and that notes start with <code>*</code> or <code>-</code>.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {importPreview.map((b, i) => (
                      <li key={i} className="text-ink-700">
                        <span className="font-medium">{b.title}</span>
                        <span className="text-ink-400"> — {b.author || "Unknown"}</span>
                        <span className="text-ink-300 text-xs"> · {b.chapters.length} chapter{b.chapters.length !== 1 ? "s" : ""}, {countNotes(b)} note{countNotes(b) !== 1 ? "s" : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetImport}
                className="flex-1 border border-parchment-300 text-ink-500 text-sm font-medium py-2.5 rounded-lg hover:bg-parchment-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={importPreview.length === 0 || importing}
                className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {importing ? "Importing…" : importPreview.length > 1 ? `Import ${importPreview.length} books` : "Import book"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add book modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={resetForm}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-semibold text-ink-900 mb-5">Add a Book</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 uppercase tracking-wide mb-1.5">
                  Title
                </label>
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBook()}
                  placeholder="e.g. Atomic Habits"
                  className="w-full border border-parchment-300 rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 uppercase tracking-wide mb-1.5">
                  Author
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBook()}
                  placeholder="e.g. James Clear"
                  className="w-full border border-parchment-300 rounded-lg px-3 py-2.5 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 uppercase tracking-wide mb-1.5">
                  Date Completed <span className="normal-case text-ink-300 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={dateCompleted}
                  onChange={(e) => setDateCompleted(e.target.value)}
                  className="w-full border border-parchment-300 rounded-lg px-3 py-2.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 uppercase tracking-wide mb-1.5">
                  Tags <span className="normal-case text-ink-300 font-normal">(optional)</span>
                </label>
                <TagInput tags={newTags} onChange={setNewTags} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={resetForm}
                className="flex-1 border border-parchment-300 text-ink-500 text-sm font-medium py-2.5 rounded-lg hover:bg-parchment-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addBook}
                disabled={!title.trim() || !author.trim()}
                className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Add Book
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
