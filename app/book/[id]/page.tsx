"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Book, Chapter, Note } from "@/lib/types";
import { generateId } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";

// Per-level bullet styles
const BULLET = ["•", "◦", "▸"] as const;
const BULLET_COLOR = ["text-amber-600", "text-ink-400", "text-ink-300"] as const;
const INDENT_PX = [0, 20, 40] as const;
// Markdown indent prefix per level
const MD_PREFIX = ["- ", "  - ", "    - "] as const;

function exportMarkdown(book: Book): void {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push(`*${book.author}*`);
  lines.push("");
  for (const chapter of book.chapters) {
    lines.push(`## ${chapter.name}`);
    lines.push("");
    for (const note of chapter.notes) {
      const level = Math.min(note.indent ?? 0, 2);
      lines.push(`${MD_PREFIX[level]}${note.text}`);
    }
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${book.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-notes.md`;
  a.click();
  URL.revokeObjectURL(url);
}

interface SearchResult {
  chapterId: string;
  chapterName: string;
  noteId?: string;
  noteText?: string;
  matchType: "chapter" | "note";
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-ink-900 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function BookPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const { books, loading: booksLoading, upsertBook } = useBooks();

  const [book, setBook] = useState<Book | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [noteIndent, setNoteIndent] = useState(0);
  const [chapterInput, setChapterInput] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingChapterName, setEditingChapterName] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteIndent, setEditingNoteIndent] = useState(0);
  const noteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authLoading || booksLoading) return;
    if (!user) { router.push("/"); return; }
    const found = books.find((b) => b.id === id);
    if (!found) { router.push("/"); return; }
    setBook(found);
    setActiveChapterId((prev) => prev ?? found.chapters[0]?.id ?? null);
  }, [id, user, authLoading, books, booksLoading, router]);

  async function persist(updated: Book) {
    if (!user) return;
    setBook(updated);
    await upsertBook(updated);
  }

  function addChapter() {
    if (!book || !chapterInput.trim()) return;
    const chapter: Chapter = { id: generateId(), name: chapterInput.trim(), notes: [] };
    const updated = { ...book, chapters: [...book.chapters, chapter] };
    persist(updated);
    setActiveChapterId(chapter.id);
    setChapterInput("");
    setAddingChapter(false);
  }

  function deleteChapter(chapterId: string) {
    if (!book || !confirm("Delete this chapter and all its notes?")) return;
    const updated = { ...book, chapters: book.chapters.filter((c) => c.id !== chapterId) };
    persist(updated);
    if (activeChapterId === chapterId) setActiveChapterId(updated.chapters[0]?.id ?? null);
  }

  function saveChapterName(chapterId: string) {
    if (!book || !editingChapterName.trim()) return;
    persist({ ...book, chapters: book.chapters.map((c) => c.id === chapterId ? { ...c, name: editingChapterName.trim() } : c) });
    setEditingChapterId(null);
  }

  function addNote() {
    if (!book || !activeChapterId || !noteInput.trim()) return;
    const note: Note = {
      id: generateId(),
      text: noteInput.trim(),
      indent: noteIndent,
      createdAt: new Date().toISOString(),
    };
    persist({ ...book, chapters: book.chapters.map((c) => c.id === activeChapterId ? { ...c, notes: [...c.notes, note] } : c) });
    setNoteInput("");
    // Keep same indent level for fast consecutive sub-point entry
    noteInputRef.current?.focus();
  }

  function changeNoteIndent(chapterId: string, noteId: string, delta: number) {
    if (!book) return;
    persist({
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, indent: Math.max(0, Math.min(2, (n.indent ?? 0) + delta)) } : n) }
          : c
      ),
    });
  }

  function deleteNote(chapterId: string, noteId: string) {
    if (!book) return;
    persist({ ...book, chapters: book.chapters.map((c) => c.id === chapterId ? { ...c, notes: c.notes.filter((n) => n.id !== noteId) } : c) });
  }

  function saveNoteEdit(chapterId: string, noteId: string) {
    if (!book || !editingNoteText.trim()) return;
    persist({
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, text: editingNoteText.trim(), indent: editingNoteIndent } : n) }
          : c
      ),
    });
    setEditingNoteId(null);
  }

  const searchResults: SearchResult[] = [];
  if (book && search.trim()) {
    const q = search.toLowerCase();
    for (const chapter of book.chapters) {
      if (chapter.name.toLowerCase().includes(q)) {
        searchResults.push({ chapterId: chapter.id, chapterName: chapter.name, matchType: "chapter" });
      }
      for (const note of chapter.notes) {
        if (note.text.toLowerCase().includes(q)) {
          searchResults.push({ chapterId: chapter.id, chapterName: chapter.name, noteId: note.id, noteText: note.text, matchType: "note" });
        }
      }
    }
  }

  const activeChapter = book?.chapters.find((c) => c.id === activeChapterId);

  if (authLoading || booksLoading || !book) {
    return (
      <div className="min-h-screen bg-parchment-50 flex items-center justify-center">
        <p className="text-ink-300 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-parchment-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-parchment-300 bg-parchment-100 px-6 py-4 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => router.push("/")} className="text-ink-300 hover:text-amber-600 transition-colors text-sm flex-shrink-0">
              ← Library
            </button>
            <span className="text-parchment-300">|</span>
            <div className="min-w-0">
              <h1 className="font-serif font-semibold text-ink-900 text-lg leading-tight truncate">{book.title}</h1>
              <p className="text-ink-300 text-xs italic truncate">{book.author}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="relative">
              <input
                type="text"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white border border-parchment-300 rounded-lg pl-8 pr-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent w-48"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300 text-xs">🔍</span>
            </div>
            <button
              onClick={() => exportMarkdown(book)}
              className="flex items-center gap-1.5 border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <span>↓</span> Export MD
            </button>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {search.trim() && (
        <div className="border-b border-parchment-300 bg-white px-6 py-4">
          <div className="max-w-6xl mx-auto">
            <p className="text-xs text-ink-300 mb-3 uppercase tracking-wide font-medium">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
            </p>
            {searchResults.length === 0 ? (
              <p className="text-ink-300 text-sm italic">Nothing found.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => { setActiveChapterId(r.chapterId); setSearch(""); }}
                    className="flex items-start gap-3 w-full text-left bg-parchment-50 hover:bg-amber-100 border border-parchment-200 rounded-lg px-4 py-3 transition-colors"
                  >
                    <span className="text-xs bg-parchment-200 text-ink-500 px-2 py-0.5 rounded font-medium flex-shrink-0 mt-0.5">
                      {r.matchType === "chapter" ? "Chapter" : "Note"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-ink-300 mb-0.5">{highlight(r.chapterName, search)}</p>
                      {r.noteText && <p className="text-sm text-ink-700">{highlight(r.noteText, search)}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 max-w-6xl mx-auto w-full">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-parchment-300 bg-parchment-100 flex flex-col">
          <div className="p-4 border-b border-parchment-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-300 uppercase tracking-wide">Chapters</span>
              <button onClick={() => setAddingChapter(true)} className="text-amber-600 hover:text-amber-500 text-xl leading-none">+</button>
            </div>
          </div>

          {addingChapter && (
            <div className="px-3 pt-3">
              <input autoFocus type="text" value={chapterInput} onChange={(e) => setChapterInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addChapter(); if (e.key === "Escape") setAddingChapter(false); }}
                placeholder="Chapter name..."
                className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={addChapter} disabled={!chapterInput.trim()} className="flex-1 bg-amber-600 disabled:opacity-40 text-white text-xs py-1.5 rounded-md">Add</button>
                <button onClick={() => setAddingChapter(false)} className="flex-1 border border-parchment-300 text-ink-500 text-xs py-1.5 rounded-md">Cancel</button>
              </div>
            </div>
          )}

          <nav className="flex-1 overflow-y-auto py-2">
            {book.chapters.length === 0 && !addingChapter && (
              <p className="text-ink-300 text-xs italic px-4 py-3">No chapters yet.</p>
            )}
            {book.chapters.map((chapter) => (
              <div key={chapter.id} className="group relative">
                {editingChapterId === chapter.id ? (
                  <div className="px-3 py-1">
                    <input autoFocus type="text" value={editingChapterName} onChange={(e) => setEditingChapterName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveChapterName(chapter.id); if (e.key === "Escape") setEditingChapterId(null); }}
                      onBlur={() => saveChapterName(chapter.id)}
                      className="w-full border border-amber-500 rounded px-2 py-1 text-sm text-ink-900 focus:outline-none bg-white"
                    />
                  </div>
                ) : (
                  <button onClick={() => setActiveChapterId(chapter.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${activeChapterId === chapter.id ? "bg-amber-600 text-white" : "text-ink-700 hover:bg-parchment-200"}`}
                  >
                    <span className="truncate">{chapter.name}</span>
                    <span className={`text-xs flex-shrink-0 ${activeChapterId === chapter.id ? "text-amber-100" : "text-ink-300"}`}>{chapter.notes.length}</span>
                  </button>
                )}
                {editingChapterId !== chapter.id && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5">
                    <button onClick={() => { setEditingChapterId(chapter.id); setEditingChapterName(chapter.name); }}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-ink-700 hover:bg-parchment-300"}`}>✎</button>
                    <button onClick={() => deleteChapter(chapter.id)}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-red-500 hover:bg-parchment-300"}`}>×</button>
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {!activeChapter ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <p className="text-4xl mb-3">📝</p>
                <p className="font-serif italic text-ink-500 text-lg">
                  {book.chapters.length === 0 ? "Add your first chapter to start taking notes." : "Select a chapter to view its notes."}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-8 py-5 border-b border-parchment-200">
                <h2 className="font-serif font-semibold text-ink-900 text-xl">{activeChapter.name}</h2>
                <p className="text-ink-300 text-xs mt-0.5">{activeChapter.notes.length} note{activeChapter.notes.length !== 1 ? "s" : ""}</p>
              </div>

              {/* Notes list */}
              <div className="flex-1 overflow-y-auto px-8 py-5">
                {activeChapter.notes.length === 0 ? (
                  <p className="text-ink-300 text-sm italic">No notes yet. Add your first note below.</p>
                ) : (
                  <ul className="space-y-1">
                    {activeChapter.notes.map((note) => {
                      const level = Math.min(note.indent ?? 0, 2);
                      return (
                        <li key={note.id} className="group flex items-start gap-2" style={{ paddingLeft: INDENT_PX[level] }}>
                          <span className={`mt-1 flex-shrink-0 text-sm leading-tight select-none w-4 text-center ${BULLET_COLOR[level]}`}>
                            {BULLET[level]}
                          </span>
                          {editingNoteId === note.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                autoFocus
                                type="text"
                                value={editingNoteText}
                                onChange={(e) => setEditingNoteText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Tab") { e.preventDefault(); setEditingNoteIndent((i) => e.shiftKey ? Math.max(0, i - 1) : Math.min(2, i + 1)); }
                                  if (e.key === "Enter") saveNoteEdit(activeChapter.id, note.id);
                                  if (e.key === "Escape") setEditingNoteId(null);
                                }}
                                onBlur={() => saveNoteEdit(activeChapter.id, note.id)}
                                className="flex-1 border border-amber-500 rounded px-2 py-0.5 text-sm text-ink-900 focus:outline-none bg-white"
                              />
                              <span className="text-xs text-ink-300 flex-shrink-0">
                                L{editingNoteIndent + 1} · Tab↹
                              </span>
                            </div>
                          ) : (
                            <span className="flex-1 text-sm text-ink-800 leading-relaxed">{note.text}</span>
                          )}
                          {editingNoteId !== note.id && (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                              <button onClick={() => changeNoteIndent(activeChapter.id, note.id, -1)} disabled={level === 0}
                                className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Outdent (Shift+Tab)">←</button>
                              <button onClick={() => changeNoteIndent(activeChapter.id, note.id, 1)} disabled={level === 2}
                                className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Indent (Tab)">→</button>
                              <button onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); setEditingNoteIndent(level); }}
                                className="text-ink-300 hover:text-ink-700 text-xs p-0.5">✎</button>
                              <button onClick={() => deleteNote(activeChapter.id, note.id)}
                                className="text-ink-300 hover:text-red-500 text-sm p-0.5 leading-none">×</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Note input */}
              <div className="px-8 py-4 border-t border-parchment-200 bg-parchment-50">
                <div className="flex gap-3 items-center">
                  {/* Indent level indicator */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    {[0, 1, 2].map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setNoteIndent(lvl)}
                        title={`Level ${lvl + 1}`}
                        className={`w-5 h-1.5 rounded-full transition-colors ${noteIndent === lvl ? "bg-amber-500" : "bg-parchment-300 hover:bg-parchment-400"}`}
                      />
                    ))}
                  </div>
                  <div className="flex-1 relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex-shrink-0 pointer-events-none">
                      <span className={`text-sm ${BULLET_COLOR[noteIndent]}`}>{BULLET[noteIndent]}</span>
                    </div>
                    <input
                      ref={noteInputRef}
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") { e.preventDefault(); setNoteIndent((i) => e.shiftKey ? Math.max(0, i - 1) : Math.min(2, i + 1)); }
                        if (e.key === "Enter") addNote();
                      }}
                      placeholder={`Add a level ${noteIndent + 1} note… (Tab to indent)`}
                      className="w-full bg-white border border-parchment-300 rounded-lg pl-8 pr-4 py-2.5 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={addNote}
                    disabled={!noteInput.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                  >
                    Add
                  </button>
                </div>
                <p className="text-xs text-ink-300 mt-1.5 pl-8">Tab = indent · Shift+Tab = outdent · Enter = add</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
