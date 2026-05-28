"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Book, Chapter, Note } from "@/lib/types";
import { generateId } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";

const BULLET_CHAR = ["•", "◦", "▸"] as const;
const BULLET_COLOR = ["text-amber-600", "text-ink-400", "text-ink-300"] as const;
const INDENT_PX = [0, 20, 40] as const;
const SPACES = ["", "  ", "    "] as const;

// Calculate sequential numbers for numbered notes at each indent level.
// Resets when a note at the same or shallower level uses a different type.
function buildNumberMap(notes: Note[]): Map<string, number> {
  const counters = [0, 0, 0];
  const map = new Map<string, number>();
  for (const note of notes) {
    const lvl = Math.min(note.indent ?? 0, 2);
    if ((note.type ?? "bullet") === "numbered") {
      counters[lvl]++;
      // Reset deeper levels when this level increments
      for (let i = lvl + 1; i <= 2; i++) counters[i] = 0;
      map.set(note.id, counters[lvl]);
    } else {
      // A bullet at this level resets the numbered counter at this level
      counters[lvl] = 0;
      for (let i = lvl + 1; i <= 2; i++) counters[i] = 0;
    }
  }
  return map;
}

function exportMarkdown(book: Book): void {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push(`*${book.author}*`);
  lines.push("");
  for (const chapter of book.chapters) {
    const chapterHeading = chapter.number ? `${chapter.number}. ${chapter.name}` : chapter.name;
    lines.push(`## ${chapterHeading}`);
    lines.push("");
    const nums = buildNumberMap(chapter.notes);
    for (const note of chapter.notes) {
      const lvl = Math.min(note.indent ?? 0, 2);
      const sp = SPACES[lvl];
      if ((note.type ?? "bullet") === "numbered") {
        lines.push(`${sp}${nums.get(note.id)}. ${note.text}`);
      } else {
        lines.push(`${sp}- ${note.text}`);
      }
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

// Turn spoken punctuation words into glyphs, fix spacing, and auto-capitalize.
// Idempotent: safe to apply repeatedly as more transcript text arrives.
function normalizeDictation(text: string): string {
  if (!text) return text;
  // Order: longer phrases first so "exclamation point" beats "exclamation".
  const subs: [RegExp, string][] = [
    [/\bexclamation (point|mark)\b/gi, "!"],
    [/\bquestion mark\b/gi, "?"],
    [/\bfull stop\b/gi, "."],
    [/\bopen (paren|parenthesis)\b/gi, "("],
    [/\bclose (paren|parenthesis)\b/gi, ")"],
    [/\bopen quote\b/gi, "\""],
    [/\bclose quote\b/gi, "\""],
    [/\bperiod\b/gi, "."],
    [/\bcomma\b/gi, ","],
    [/\bexclamation\b/gi, "!"],
    [/\bsemicolon\b/gi, ";"],
    [/\bcolon\b/gi, ":"],
    [/\b(dash|hyphen)\b/gi, "-"],
    [/\bapostrophe\b/gi, "'"],
    [/\bquote\b/gi, "\""],
  ];
  let out = text;
  for (const [re, repl] of subs) out = out.replace(re, repl);
  // Remove space before closing punctuation / inside an opening paren
  out = out.replace(/\s+([.,!?;:)])/g, "$1");
  out = out.replace(/(\()\s+/g, "$1");
  // Ensure a single space after sentence-ending punctuation when a letter follows
  out = out.replace(/([.!?])\s*([A-Za-z])/g, "$1 $2");
  // Capitalize the first letter of the whole string
  out = out.replace(/^(\s*)([a-z])/, (_, ws, c) => ws + c.toUpperCase());
  // Capitalize the letter after a sentence-ending punctuation
  out = out.replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  // Collapse runs of spaces
  out = out.replace(/ {2,}/g, " ");
  return out;
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
  const [noteType, setNoteType] = useState<"bullet" | "numbered">("bullet");
  const [chapterInput, setChapterInput] = useState("");
  const [chapterNumberInput, setChapterNumberInput] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingChapterName, setEditingChapterName] = useState("");
  const [editingChapterNumber, setEditingChapterNumber] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteIndent, setEditingNoteIndent] = useState(0);
  const [editingNoteType, setEditingNoteType] = useState<"bullet" | "numbered">("bullet");
  const [listening, setListening] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768
  );
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const cameFromDictationRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Enumerate audio input devices (labels only available after permission is granted)
  function refreshMicDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices()
      .then((all) => setMicDevices(all.filter((d) => d.kind === "audioinput")))
      .catch(() => {});
  }

  useEffect(() => { if (speechSupported) refreshMicDevices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any active recognition and release mic when the page unmounts
  useEffect(() => () => {
    shouldListenRef.current = false;
    recognitionRef.current?.stop?.();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  function startRecognition(baseText: string, finalDictatedRef: { value: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      cameFromDictationRef.current = true;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) {
          const trimmed = transcript.trim();
          if (/^new\s+bullet[\s.,!?]*$/i.test(trimmed)) {
            const raw = [baseText, finalDictatedRef.value].filter(Boolean).join(" ").trim();
            const noteText = normalizeDictation(raw);
            if (noteText) addNoteRef.current(noteText);
            baseText = "";
            finalDictatedRef.value = "";
            setNoteInput("");
            continue;
          }
          if (/^indent[\s.,!?]*$/i.test(trimmed)) {
            setNoteIndent((i) => Math.min(2, i + 1));
            continue;
          }
          if (/^out\s?dent[\s.,!?]*$/i.test(trimmed)) {
            setNoteIndent((i) => Math.max(0, i - 1));
            continue;
          }
          finalDictatedRef.value += (finalDictatedRef.value ? " " : "") + trimmed;
        } else {
          interim += transcript;
        }
      }
      const combined = [baseText, finalDictatedRef.value, interim.trim()].filter(Boolean).join(" ");
      setNoteInput(normalizeDictation(combined));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      // Stop permanently on permission errors; onend will always fire after and handles restart
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        shouldListenRef.current = false;
      }
    };
    rec.onend = () => {
      if (recognitionRef.current !== rec) return; // stale callback from a previous session
      if (shouldListenRef.current) {
        // Chrome kills continuous recognition after silence on desktop; restart automatically
        try { startRecognition(baseText, finalDictatedRef); return; } catch { /* fall through */ }
      }
      // Truly done — release the mic stream
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setListening(false);
    };

    rec.start();
    recognitionRef.current = rec;
  }

  async function toggleDictation() {
    if (!speechSupported) return;
    if (listening) {
      shouldListenRef.current = false;
      recognitionRef.current?.stop?.();
      // mic stream released in onend after recognition fully stops
      return;
    }
    noteInputRef.current?.focus();

    // Open the mic first and keep the stream alive through the recognition session.
    // On Windows/WASAPI, stopping the stream immediately and then starting Web Speech API
    // causes a race where the mic is re-acquired before the OS finishes releasing it.
    // Holding the stream open avoids that and also helps Chrome route the selected device.
    try {
      const audioConstraint = selectedMicId ? { deviceId: { ideal: selectedMicId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      micStreamRef.current = stream; // held open until onend releases it
      refreshMicDevices(); // labels now available since permission was just granted
    } catch {
      return; // permission denied or device unavailable — bail without turning on the button
    }

    shouldListenRef.current = true;
    const finalDictatedRef = { value: "" };
    startRecognition(noteInput.trimEnd(), finalDictatedRef);
    setListening(true);
  }

  // Resize the note input whenever its value changes (covers dictation and clear-on-add)
  useEffect(() => {
    const el = noteInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [noteInput]);

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
    const num = chapterNumberInput.trim();
    const chapter: Chapter = {
      id: generateId(),
      name: chapterInput.trim(),
      notes: [],
      ...(num ? { number: num } : {}),
    };
    const updated = { ...book, chapters: [...book.chapters, chapter] };
    persist(updated);
    setActiveChapterId(chapter.id);
    setChapterInput("");
    setChapterNumberInput("");
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
    const num = editingChapterNumber.trim();
    persist({
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, name: editingChapterName.trim(), number: num || undefined }
          : c
      ),
    });
    setEditingChapterId(null);
  }

  async function polishWithGemini(raw: string): Promise<string> {
    try {
      const res = await fetch("/api/polish-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (!res.ok) return raw;
      const data = await res.json();
      const result = typeof data?.text === "string" && data.text.trim() ? data.text.trim() : raw;
      // Fall back to original if Gemini dropped a significant portion of the content
      const wordCount = (s: string) => s.trim().split(/\s+/).length;
      return wordCount(result) >= wordCount(raw) * 0.85 ? result : raw;
    } catch {
      return raw;
    }
  }

  async function addNote(textOverride?: string) {
    if (!book || !activeChapterId) return;
    const targetChapterId = activeChapterId;
    let text = (textOverride ?? noteInput).trim();
    if (!text) return;

    const fromDictation = cameFromDictationRef.current;
    cameFromDictationRef.current = false;
    setNoteInput("");
    noteInputRef.current?.focus();

    if (fromDictation) {
      // Strip any stray "new bullet" voice commands captured in the transcript
      text = text.replace(/\bnew\s+bullet\b[\s.,!?]*/gi, "").trim();
      if (!text) return;
      setPolishing(true);
      text = await polishWithGemini(text);
      setPolishing(false);
    }

    // Always end with sentence-closing punctuation, typed or dictated
    if (!/[.!?]$/.test(text)) text += ".";

    const note: Note = {
      id: generateId(),
      text,
      indent: noteIndent,
      type: noteType,
      createdAt: new Date().toISOString(),
    };
    // Use the freshest book in case other notes landed during the polish round-trip
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === targetChapterId ? { ...c, notes: [...c.notes, note] } : c,
      ),
    });
  }

  // Always-current book ref so async addNote isn't racing stale state
  const bookRef = useRef(book);
  useEffect(() => { bookRef.current = book; });

  // Keep an always-fresh reference so the speech callback never holds stale state
  const addNoteRef = useRef(addNote);
  useEffect(() => { addNoteRef.current = addNote; });

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
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, text: editingNoteText.trim(), indent: editingNoteIndent, type: editingNoteType } : n) }
          : c
      ),
    });
    setEditingNoteId(null);
  }

  const searchResults: SearchResult[] = [];
  if (book && search.trim()) {
    const q = search.toLowerCase();
    for (const chapter of book.chapters) {
      const displayName = chapter.number ? `${chapter.number}. ${chapter.name}` : chapter.name;
      if (chapter.name.toLowerCase().includes(q)) {
        searchResults.push({ chapterId: chapter.id, chapterName: displayName, matchType: "chapter" });
      }
      for (const note of chapter.notes) {
        if (note.text.toLowerCase().includes(q)) {
          searchResults.push({ chapterId: chapter.id, chapterName: displayName, noteId: note.id, noteText: note.text, matchType: "note" });
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
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
              <label className="text-xs text-ink-300 whitespace-nowrap">Completed:</label>
              <input
                type="date"
                value={book.dateCompleted ?? ""}
                onChange={(e) => persist({ ...book, dateCompleted: e.target.value || undefined })}
                className="text-xs border border-parchment-300 rounded px-2 py-1 text-ink-700 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
              />
              {book.dateCompleted && (
                <button
                  onClick={() => persist({ ...book, dateCompleted: undefined })}
                  className="text-ink-300 hover:text-red-400 text-xs"
                  title="Clear date"
                >×</button>
              )}
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
        {/* Sidebar — collapsed: thin vertical tab; expanded: full chapter list */}
        {!sidebarOpen ? (
          <aside className="w-9 flex-shrink-0 border-r border-parchment-300 bg-parchment-100">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-full h-full flex items-center justify-center hover:bg-parchment-200 transition-colors py-4"
              title="Show chapters"
            >
              <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-medium text-ink-500 uppercase tracking-wider whitespace-nowrap">
                Chapters · {book.chapters.length}
              </span>
            </button>
          </aside>
        ) : (
        <aside className="w-64 flex-shrink-0 border-r border-parchment-300 bg-parchment-100 flex flex-col">
          <div className="p-4 border-b border-parchment-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-300 uppercase tracking-wide">Chapters</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setAddingChapter(true)} className="text-amber-600 hover:text-amber-500 text-xl leading-none" title="Add chapter">+</button>
                <button onClick={() => setSidebarOpen(false)} className="text-ink-300 hover:text-ink-700 text-base leading-none" title="Hide chapters">«</button>
              </div>
            </div>
          </div>

          {addingChapter && (
            <div className="px-3 pt-3">
              <div className="flex gap-1.5">
                <input type="text" value={chapterNumberInput} onChange={(e) => setChapterNumberInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addChapter(); if (e.key === "Escape") setAddingChapter(false); }}
                  placeholder="#"
                  className="w-12 border border-parchment-300 rounded-lg px-2 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white text-center"
                />
                <input autoFocus type="text" value={chapterInput} onChange={(e) => setChapterInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addChapter(); if (e.key === "Escape") setAddingChapter(false); }}
                  placeholder="Chapter name..."
                  className="flex-1 border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={addChapter} disabled={!chapterInput.trim()} className="flex-1 bg-amber-600 disabled:opacity-40 text-white text-xs py-1.5 rounded-md">Add</button>
                <button onClick={() => { setAddingChapter(false); setChapterNumberInput(""); setChapterInput(""); }} className="flex-1 border border-parchment-300 text-ink-500 text-xs py-1.5 rounded-md">Cancel</button>
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
                  <div
                    className="px-3 py-1 flex gap-1.5"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        saveChapterName(chapter.id);
                      }
                    }}
                  >
                    <input type="text" value={editingChapterNumber} onChange={(e) => setEditingChapterNumber(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveChapterName(chapter.id); if (e.key === "Escape") setEditingChapterId(null); }}
                      placeholder="#"
                      className="w-10 border border-amber-500 rounded px-1.5 py-1 text-sm text-ink-900 focus:outline-none bg-white text-center"
                    />
                    <input autoFocus type="text" value={editingChapterName} onChange={(e) => setEditingChapterName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveChapterName(chapter.id); if (e.key === "Escape") setEditingChapterId(null); }}
                      className="flex-1 border border-amber-500 rounded px-2 py-1 text-sm text-ink-900 focus:outline-none bg-white"
                    />
                  </div>
                ) : (
                  <button onClick={() => setActiveChapterId(chapter.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${activeChapterId === chapter.id ? "bg-amber-600 text-white" : "text-ink-700 hover:bg-parchment-200"}`}
                  >
                    <span className="truncate">
                      {chapter.number && (
                        <span className={`mr-1.5 font-medium ${activeChapterId === chapter.id ? "text-amber-100" : "text-ink-300"}`}>
                          {chapter.number}.
                        </span>
                      )}
                      {chapter.name}
                    </span>
                    <span className={`text-xs flex-shrink-0 ${activeChapterId === chapter.id ? "text-amber-100" : "text-ink-300"}`}>{chapter.notes.length}</span>
                  </button>
                )}
                {editingChapterId !== chapter.id && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5">
                    <button onClick={() => { setEditingChapterId(chapter.id); setEditingChapterName(chapter.name); setEditingChapterNumber(chapter.number ?? ""); }}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-ink-700 hover:bg-parchment-300"}`}>✎</button>
                    <button onClick={() => deleteChapter(chapter.id)}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-red-500 hover:bg-parchment-300"}`}>×</button>
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>
        )}

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
                <h2 className="font-serif font-semibold text-ink-900 text-xl">
                  {activeChapter.number && (
                    <span className="text-ink-300 mr-2">{activeChapter.number}.</span>
                  )}
                  {activeChapter.name}
                </h2>
                <p className="text-ink-300 text-xs mt-0.5">{activeChapter.notes.length} note{activeChapter.notes.length !== 1 ? "s" : ""}</p>
              </div>

              {/* Notes list */}
              <div className="flex-1 overflow-y-auto px-8 py-5">
                {activeChapter.notes.length === 0 ? (
                  <p className="text-ink-300 text-sm italic">No notes yet. Add your first note below.</p>
                ) : (
                  <ul className="space-y-1">
                    {(() => {
                      const numMap = buildNumberMap(activeChapter.notes);
                      return activeChapter.notes.map((note) => {
                        const level = Math.min(note.indent ?? 0, 2);
                        const isNumbered = (note.type ?? "bullet") === "numbered";
                        const marker = isNumbered
                          ? `${numMap.get(note.id)}.`
                          : BULLET_CHAR[level];
                        return (
                          <li key={note.id} className="group flex items-start gap-2" style={{ paddingLeft: INDENT_PX[level] }}>
                            <span className={`mt-0.5 flex-shrink-0 text-sm leading-tight select-none min-w-[1.25rem] text-right ${BULLET_COLOR[level]}`}>
                              {marker}
                            </span>
                            {editingNoteId === note.id ? (
                              <div className="flex-1 flex items-center gap-2">
                                <button
                                  onClick={() => setEditingNoteType((t) => t === "bullet" ? "numbered" : "bullet")}
                                  className="flex-shrink-0 text-xs border border-parchment-300 rounded px-1.5 py-0.5 text-ink-500 hover:border-amber-500 hover:text-amber-600 transition-colors"
                                  title="Toggle bullet / numbered"
                                >
                                  {editingNoteType === "numbered" ? "1." : "•"}
                                </button>
                                <textarea
                                  autoFocus
                                  rows={1}
                                  ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                                  value={editingNoteText}
                                  onChange={(e) => {
                                    setEditingNoteText(e.target.value);
                                    e.target.style.height = "auto";
                                    e.target.style.height = e.target.scrollHeight + "px";
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Tab") { e.preventDefault(); setEditingNoteIndent((i) => e.shiftKey ? Math.max(0, i - 1) : Math.min(2, i + 1)); }
                                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNoteEdit(activeChapter.id, note.id); }
                                    if (e.key === "Escape") setEditingNoteId(null);
                                  }}
                                  onBlur={() => saveNoteEdit(activeChapter.id, note.id)}
                                  className="flex-1 border border-amber-500 rounded px-2 py-0.5 text-sm text-ink-900 focus:outline-none bg-white resize-none overflow-hidden leading-snug"
                                />
                              </div>
                            ) : (
                              <span className="flex-1 text-sm text-ink-800 leading-relaxed">{note.text}</span>
                            )}
                            {editingNoteId !== note.id && (
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                                <button onClick={() => changeNoteIndent(activeChapter.id, note.id, -1)} disabled={level === 0}
                                  className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Outdent">←</button>
                                <button onClick={() => changeNoteIndent(activeChapter.id, note.id, 1)} disabled={level === 2}
                                  className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Indent">→</button>
                                <button onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); setEditingNoteIndent(level); setEditingNoteType(note.type ?? "bullet"); }}
                                  className="text-ink-300 hover:text-ink-700 text-xs p-0.5">✎</button>
                                <button onClick={() => deleteNote(activeChapter.id, note.id)}
                                  className="text-ink-300 hover:text-red-500 text-sm p-0.5 leading-none">×</button>
                              </div>
                            )}
                          </li>
                        );
                      });
                    })()}
                  </ul>
                )}
              </div>

              {/* Note input */}
              <div className="px-8 py-4 border-t border-parchment-200 bg-parchment-50">
                <div className="flex gap-2 items-center">
                  {/* Bullet / Numbered toggle */}
                  <div className="flex flex-shrink-0 border border-parchment-300 rounded-lg overflow-hidden text-xs font-medium">
                    <button
                      onClick={() => setNoteType("bullet")}
                      className={`px-2.5 py-2 transition-colors ${noteType === "bullet" ? "bg-amber-600 text-white" : "text-ink-500 hover:bg-parchment-200"}`}
                      title="Bullet list"
                    >•</button>
                    <button
                      onClick={() => setNoteType("numbered")}
                      className={`px-2.5 py-2 transition-colors border-l border-parchment-300 ${noteType === "numbered" ? "bg-amber-600 text-white" : "text-ink-500 hover:bg-parchment-200"}`}
                      title="Numbered list"
                    >1.</button>
                  </div>

                  {/* Indent level dots */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    {[0, 1, 2].map((lvl) => (
                      <button key={lvl} onClick={() => setNoteIndent(lvl)} title={`Level ${lvl + 1}`}
                        className={`w-4 h-1.5 rounded-full transition-colors ${noteIndent === lvl ? "bg-amber-500" : "bg-parchment-300 hover:bg-parchment-400"}`}
                      />
                    ))}
                  </div>

                  <div className="flex-1 relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <span className={`text-sm ${BULLET_COLOR[noteIndent]}`}>
                        {noteType === "numbered" ? "#." : BULLET_CHAR[noteIndent]}
                      </span>
                    </div>
                    <textarea
                      ref={noteInputRef}
                      rows={1}
                      value={noteInput}
                      onChange={(e) => {
                        setNoteInput(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                        if (!listening) cameFromDictationRef.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") { e.preventDefault(); setNoteIndent((i) => e.shiftKey ? Math.max(0, i - 1) : Math.min(2, i + 1)); }
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); }
                      }}
                      placeholder={`Add a ${noteType === "numbered" ? "numbered" : "bullet"} note… (Tab to indent)`}
                      className="w-full bg-white border border-parchment-300 rounded-lg pl-8 pr-4 py-2.5 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none overflow-hidden leading-snug"
                    />
                  </div>
                  {speechSupported && (
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {micDevices.length > 1 && (
                        <select
                          value={selectedMicId}
                          onChange={(e) => setSelectedMicId(e.target.value)}
                          disabled={listening}
                          title="Select microphone"
                          className="text-xs border border-parchment-300 rounded-lg px-2 py-2.5 text-ink-500 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[130px] disabled:opacity-50"
                        >
                          <option value="">Default mic</option>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={toggleDictation}
                        title={listening ? "Stop dictation" : "Dictate note"}
                        className={`text-sm px-3 py-2.5 rounded-lg transition-colors border ${
                          listening
                            ? "bg-red-500 hover:bg-red-400 text-white border-red-500 animate-pulse"
                            : "bg-white text-ink-500 border-parchment-300 hover:border-amber-500 hover:text-amber-600"
                        }`}
                      >
                        {listening ? "■" : "🎤"}
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => addNote()}
                    disabled={!noteInput.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                  >
                    Add
                  </button>
                </div>
                <p className="text-xs text-ink-300 mt-1.5 ml-20">
                  Tab = indent · Shift+Tab = outdent · Enter = add
                  {speechSupported && " · 🎤 = dictate · say \"new bullet\" / \"indent\" / \"outdent\""}
                  {polishing && (
                    <span className="ml-2 text-amber-600 font-medium">✨ polishing…</span>
                  )}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
