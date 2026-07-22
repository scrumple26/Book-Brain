"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Book, Chapter, Note, QuizCard } from "@/lib/types";
import { generateId } from "@/lib/storage";
import { highlight } from "@/lib/highlight";
import { Grade, isDue, dueSortKey, schedule, newSchedule } from "@/lib/srs";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";
import {
  AQUA_MAX_SECONDS_PER_MONTH,
  AQUA_MONTHLY_CAP_USD,
  addAquaSecondsUsed,
  aquaSpendUsd,
  fetchAquaSecondsUsed,
} from "@/lib/aqua";

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

function chapterToMarkdownLines(chapter: Chapter): string[] {
  const lines: string[] = [];
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
  return lines;
}

function exportMarkdown(book: Book): void {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push(`*${book.author}*`);
  lines.push("");
  for (const chapter of book.chapters.filter((c) => !c.deleted)) {
    lines.push(...chapterToMarkdownLines(chapter));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${book.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-notes.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportChapterMarkdown(chapter: Chapter, bookTitle: string): void {
  const lines = chapterToMarkdownLines(chapter);
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = chapter.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const safeBook = bookTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  a.download = `${safeBook}-${safeName}.md`;
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

// Turn spoken punctuation words into glyphs, fix spacing, and auto-capitalize.
// Idempotent: safe to apply repeatedly as more transcript text arrives.
// `preserveCase` keeps existing capitalization (used for Aqua/Avalon text,
// which is already correctly cased) while still honoring spoken punctuation
// words like "quotation" and "period".
function normalizeDictation(text: string, preserveCase = false): string {
  if (!text) return text;
  // Order: longer phrases first so "exclamation point" beats "exclamation".
  const subs: [RegExp, string][] = [
    [/\bexclamation (point|mark)\b/gi, "!"],
    [/\bquestion mark\b/gi, "?"],
    [/\bfull stop\b/gi, "."],
    [/\b(open|left) (paren|parenthes[ei]s)\b/gi, "("],
    [/\b(close|right) (paren|parenthes[ei]s)\b/gi, ")"],
    [/\b(open|left) (quotation mark|quotation|quote)\b/gi, "\""],
    [/\b(close|right) (quotation mark|quotation|quote)\b/gi, "\""],
    [/\bquotation marks?\b/gi, "\""],
    [/\bquotation\b/gi, "\""],
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
  // Lowercase first so Chrome's mid-segment capitalizations are stripped — but
  // not for already-cased Aqua text.
  if (!preserveCase) out = out.toLowerCase();
  // Remove space before closing punctuation / inside an opening paren
  out = out.replace(/\s+([.,!?;:)])/g, "$1");
  out = out.replace(/(\()\s+/g, "$1");
  // Fix quote spacing: opening " gets space-before/no-space-after, closing " gets no-space-before/space-after.
  // Quotes alternate open/close so we use a counter to tell them apart.
  {
    let qn = 0;
    out = out.replace(/(\s*)"(\s*)/g, (_m, pre: string, post: string) => {
      qn++;
      return qn % 2 === 1
        ? (pre.length ? " " : "") + "\""          // opening: one space before (unless at start), nothing after
        : "\"" + (post.length ? " " : "");         // closing: nothing before, one space after (unless at end)
    });
  }
  // Ensure a single space after sentence-ending punctuation when a letter follows
  out = out.replace(/([.!?])\s*([a-z])/g, "$1 $2");
  // Capitalize the first letter of the whole string
  out = out.replace(/^(\s*)([a-z])/, (_, ws, c) => ws + c.toUpperCase());
  // Capitalize the letter after a sentence-ending punctuation
  out = out.replace(/([.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  // Collapse runs of spaces
  out = out.replace(/ {2,}/g, " ");
  return out;
}

// One finalized dictation utterance. `clean` marks text that came back from
// Aqua's Avalon model (already punctuated and cased) — it must NOT go through
// normalizeDictation, whose lowercasing would destroy the model's casing.
type DictSeg = { id: number; text: string; clean?: boolean };

function segsToText(segs: DictSeg[]): string {
  return segs
    // Aqua (clean) text keeps its casing but still gets spoken-punctuation
    // words ("quotation" -> ") turned into glyphs.
    .map((s) => (s.clean ? normalizeDictation(s.text, true) : normalizeDictation(s.text)))
    .filter(Boolean)
    .join(" ")
    .replace(/ {2,}/g, " ")
    .trim();
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
  const [editingNoteBold, setEditingNoteBold] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [reviewIds, setReviewIds] = useState<string[]>([]); // frozen review queue (card ids)
  const [showAnswer, setShowAnswer] = useState(false);
  const [quizMode, setQuizMode] = useState<"review" | "manage">("review");
  const [newQuizQ, setNewQuizQ] = useState("");
  const [newQuizA, setNewQuizA] = useState("");
  const [newQuizSourceId, setNewQuizSourceId] = useState<string | undefined>(undefined);
  const [tagEditNoteId, setTagEditNoteId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [editingTakeaway, setEditingTakeaway] = useState(false);
  const [takeawayDraft, setTakeawayDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [awaitingChapterName, setAwaitingChapterName] = useState(false);
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const dragNoteIdRef = useRef<string | null>(null);
  const [dragOverNoteId, setDragOverNoteId] = useState<string | null>(null);
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
  const dictationModeRef = useRef<"note" | "chapter">("note");
  const manualEditRef = useRef<string | null>(null);

  // --- Aqua Avalon high-accuracy re-transcription + hard $10/month budget ---
  const [aquaSecondsUsed, setAquaSecondsUsed] = useState<number | null>(null);
  const [aquaCapped, setAquaCapped] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);
  const aquaSecondsRef = useRef(0);
  const aquaReadyRef = useRef(false); // usage doc loaded OK → allowed to spend
  const aquaSessionRef = useRef(false); // Aqua recording active this session
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utterRef = useRef<{ rec: MediaRecorder; chunks: BlobPart[]; startTs: number } | null>(null);
  const pendingAvalonRef = useRef<Map<number, Promise<void>>>(new Map());
  const nextSegIdRef = useRef(1);
  const dictBaseRef = useRef("");
  const dictSegsRef = useRef<{ segs: DictSeg[] } | null>(null);
  // A committed note is saved instantly from Web Speech; when its Aqua clips
  // land later they patch the saved note in place (never the live input).
  const noteSegsRef = useRef<Map<string, { chapterId: string; segs: DictSeg[] }>>(new Map());
  const segNoteRef = useRef<Map<number, string>>(new Map()); // segId -> committed noteId

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
    if (sessionTimerRef.current) { clearTimeout(sessionTimerRef.current); sessionTimerRef.current = null; }
    try { utterRef.current?.rec.stop(); } catch { /* already stopped */ }
    utterRef.current = null;
    recognitionRef.current?.stop?.();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  function beginUtterance(stream: MediaStream) {
    try {
      const mime =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : undefined;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.start();
      utterRef.current = { rec, chunks, startTs: Date.now() };
    } catch {
      // Recorder unavailable — session silently falls back to Web Speech only
      aquaSessionRef.current = false;
      utterRef.current = null;
    }
  }

  /** Close the current utterance clip. With `forSeg`, the clip goes to Aqua and
   *  the segment's text is swapped when the better transcript returns; without,
   *  the clip is discarded (voice commands and chapter names don't need Aqua,
   *  and discarded clips cost nothing). */
  function rotateUtterance(forSeg: DictSeg | null) {
    const u = utterRef.current;
    if (!u) return;
    utterRef.current = null;
    const durationSec = (Date.now() - u.startTs) / 1000;
    u.rec.onstop = () => {
      if (!forSeg || durationSec < 1) return;
      const blob = new Blob(u.chunks, { type: u.rec.mimeType || "audio/webm" });
      if (blob.size === 0) return;
      const p = transcribeUtterance(blob, durationSec, forSeg).finally(() => {
        pendingAvalonRef.current.delete(forSeg.id);
        // Once every clip for the owning note has resolved, drop its patch-
        // tracking entries so the maps don't grow for the whole session.
        prunePatchTracking(forSeg);
      });
      pendingAvalonRef.current.set(forSeg.id, p);
    };
    try {
      u.rec.stop();
    } catch {
      /* already stopped */
    }
    const stream = micStreamRef.current;
    if (aquaSessionRef.current && stream && shouldListenRef.current) beginUtterance(stream);
  }

  /** Re-render the note input from the dictation refs (base text + segments). */
  function renderDictation(interim = "") {
    const f = dictSegsRef.current;
    const parts = [
      dictBaseRef.current,
      f ? segsToText(f.segs) : "",
      interim ? normalizeDictation(interim) : "",
    ];
    setNoteInput(parts.filter(Boolean).join(" "));
  }

  async function transcribeUtterance(blob: Blob, durationSec: number, seg: DictSeg) {
    // narrow `user` itself, not just the uid — the fetch below needs its token
    if (!user || !aquaReadyRef.current) return;
    const uid = user.uid;
    // HARD BUDGET: refuse any clip that could cross the safety threshold.
    if (aquaSecondsRef.current + durationSec > AQUA_MAX_SECONDS_PER_MONTH) {
      aquaSessionRef.current = false;
      setAquaCapped(true);
      return;
    }
    // Meter BEFORE sending — the cap may only ever overcount, never undercount.
    aquaSecondsRef.current += durationSec;
    setAquaSecondsUsed(aquaSecondsRef.current);
    // AWAIT the durable meter write and fail CLOSED if it throws (invariant d):
    // a swallowed usage write would undercount the $10 cap across sessions, so a
    // failed write must disable HD dictation instead of letting this clip spend.
    try {
      await addAquaSecondsUsed(uid, durationSec);
    } catch (e) {
      console.error("Aqua usage write failed — disabling HD dictation this session:", e);
      aquaSessionRef.current = false;
      aquaReadyRef.current = false;
      return; // do not send this clip; the Web Speech text stands
    }
    try {
      const fd = new FormData();
      fd.append("audio", blob, "utterance.webm");
      // The route bills real money, so it only accepts verified callers.
      // getIdToken() refreshes a near-expired token on its own.
      const idToken = await user.getIdToken();
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      });
      if (!res.ok) {
        // 501 = key not configured, 403 = this account isn't allowed to spend.
        // Both are settled facts for the session — stop retrying every clip.
        if (res.status === 501 || res.status === 403) aquaSessionRef.current = false;
        return; // keep the Web Speech text
      }
      const data = await res.json();
      let text = typeof data?.text === "string" ? data.text.trim() : "";
      // Safety: spoken commands must never survive into note text
      text = text
        .replace(/\b(?:new|next)\s+(?:bullet|chapter)\b[\s.,!?]*/gi, " ")
        .replace(/ {2,}/g, " ")
        .trim();
      if (!text) return;
      seg.text = text;
      seg.clean = true;

      const committedNoteId = segNoteRef.current.get(seg.id);
      if (committedNoteId) {
        // This clip belongs to a note that's already saved — upgrade it in place.
        patchSavedNote(committedNoteId);
      } else if (
        shouldListenRef.current &&
        !autoStopped &&
        dictSegsRef.current?.segs.some((s) => s.id === seg.id)
      ) {
        // Still being dictated and untouched — refresh the live field.
        renderDictation();
      }
      // Otherwise the seg was backspaced/abandoned — do nothing (no reappear).
    } catch {
      // network hiccup — the Web Speech text stands
    }
  }

  /** Rebuild a saved note's text from its (now possibly cleaner) segments. */
  function patchSavedNote(noteId: string) {
    const entry = noteSegsRef.current.get(noteId);
    const current = bookRef.current;
    if (!entry || !current) return;
    const text = finalizeDictated(segsToText(entry.segs));
    if (!text) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === entry.chapterId
          ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, text } : n)) }
          : c,
      ),
    });
  }

  /** After a committed note's clips have all resolved, remove its patch-tracking
   *  entries. Without this, noteSegsRef/segNoteRef grow unbounded for the life of
   *  the page even though no further patch can ever arrive for the note. */
  function prunePatchTracking(seg: DictSeg) {
    const noteId = segNoteRef.current.get(seg.id);
    if (!noteId) return;
    const entry = noteSegsRef.current.get(noteId);
    if (!entry) { segNoteRef.current.delete(seg.id); return; }
    // Keep the entry alive while any of the note's clips are still in flight.
    if (entry.segs.some((s) => pendingAvalonRef.current.has(s.id))) return;
    noteSegsRef.current.delete(noteId);
    for (const s of entry.segs) segNoteRef.current.delete(s.id);
  }

  // Strip stray voice-command words and ensure sentence-closing punctuation.
  function finalizeDictated(raw: string): string {
    let text = raw.replace(/\b(?:new|next)\s+bullet\b[\s.,!?]*/gi, "").trim();
    if (!text) return "";
    if (!/[.!?"]$/.test(text)) text += ".";
    return text;
  }

  /** Save a note from the current dictation segments IMMEDIATELY (no waiting on
   *  Aqua). If any clip is still in flight, register the note so the clip can
   *  patch it once it lands. */
  function commitNote(base: string, segs: DictSeg[]) {
    const targetChapterId = activeChapterId;
    if (!targetChapterId) return;
    const text = finalizeDictated([base, segsToText(segs)].filter(Boolean).join(" ").trim());
    if (!text) return;
    const noteId = generateId();
    const note: Note = {
      id: noteId,
      text,
      indent: noteIndent,
      type: noteType,
      createdAt: new Date().toISOString(),
    };
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === targetChapterId ? { ...c, notes: [...c.notes, note] } : c,
      ),
    });
    // Register for Aqua patching only while clips are still pending.
    if (segs.some((s) => pendingAvalonRef.current.has(s.id))) {
      noteSegsRef.current.set(noteId, { chapterId: targetChapterId, segs });
      for (const s of segs) segNoteRef.current.set(s.id, noteId);
    }
  }

  function startRecognition(baseText: string, finalDictatedRef: { segs: DictSeg[] }) {
    dictBaseRef.current = baseText;
    dictSegsRef.current = finalDictatedRef;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      // Ignore any results that arrive after the user stopped (typed, edited,
      // or hit the button) — otherwise late audio repaints a cleared field.
      if (!shouldListenRef.current) return;
      // If the user manually edited the field, sync accumulated state to what they left.
      // hadManualEdit lets command handlers discard Chrome audio that predates the edit.
      let hadManualEdit = false;
      if (manualEditRef.current !== null) {
        baseText = manualEditRef.current.trimEnd();
        dictBaseRef.current = baseText;
        finalDictatedRef.segs = [];
        manualEditRef.current = null;
        hadManualEdit = true;
      }
      cameFromDictationRef.current = true;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) {
          const trimmed = transcript.trim();

          // Chapter-name capture mode: next utterance becomes the new chapter
          if (dictationModeRef.current === "chapter") {
            rotateUtterance(null); // chapter names don't need Aqua
            // Parse optional leading number: "3 The Great War" or "Chapter 3 The Great War"
            const numMatch = trimmed.match(/^(?:chapter\s+)?(\d+)\s+(.+)/i);
            const chapterNumber = numMatch ? numMatch[1] : "";
            const rawName = (numMatch ? numMatch[2] : trimmed)
              .replace(/^chapter\s+/i, "")
              .trim();
            // Apply punctuation normalization then title-case every word
            const normalizedName = normalizeDictation(rawName);
            const chapterName = normalizedName.replace(/\b\w/g, (c) => c.toUpperCase());
            addChapterFromVoiceRef.current(chapterNumber, chapterName);
            dictationModeRef.current = "note";
            setAwaitingChapterName(false);
            baseText = "";
            dictBaseRef.current = "";
            finalDictatedRef.segs = [];
            setNoteInput("");
            continue;
          }

          // "new chapter" command — save any pending note then enter chapter-name mode
          const chapterCmd = trimmed.match(/^(.*?)\s*\bnew\s+chapter[\s.,!?]*$/i);
          if (chapterCmd) {
            rotateUtterance(null); // clip contains the command words — discard it
            const chunk = chapterCmd[1].trim();
            // Discard pre-command audio if the user just backspaced — it predates the edit
            if (chunk && !hadManualEdit) finalDictatedRef.segs.push({ id: nextSegIdRef.current++, text: chunk });
            const segsToFlush = finalDictatedRef.segs;
            const baseToFlush = baseText;
            baseText = "";
            dictBaseRef.current = "";
            finalDictatedRef.segs = [];
            setNoteInput("");
            dictationModeRef.current = "chapter";
            setAwaitingChapterName(true);
            commitNoteRef.current(baseToFlush, segsToFlush);
            continue;
          }

          // Match "new bullet" or "next bullet" anywhere at the end of the segment
          // so Chrome lumping words together doesn't miss the command
          const bulletCmd = trimmed.match(/^(.*?)\s*\b(?:new|next)\s+bullet[\s.,!?]*$/i);
          if (bulletCmd) {
            rotateUtterance(null); // clip contains the command words — discard it
            const chunk = bulletCmd[1].trim();
            // Discard pre-command audio if the user just backspaced — it predates the edit
            if (chunk && !hadManualEdit) finalDictatedRef.segs.push({ id: nextSegIdRef.current++, text: chunk });
            const segsToFlush = finalDictatedRef.segs;
            const baseToFlush = baseText;
            baseText = "";
            dictBaseRef.current = "";
            finalDictatedRef.segs = [];
            setNoteInput("");
            commitNoteRef.current(baseToFlush, segsToFlush);
            continue;
          }
          if (/^indent[\s.,!?]*$/i.test(trimmed)) {
            rotateUtterance(null);
            setNoteIndent((i) => Math.min(2, i + 1));
            continue;
          }
          if (/^out\s?dent[\s.,!?]*$/i.test(trimmed)) {
            rotateUtterance(null);
            setNoteIndent((i) => Math.max(0, i - 1));
            continue;
          }
          const seg: DictSeg = { id: nextSegIdRef.current++, text: trimmed };
          finalDictatedRef.segs.push(seg);
          rotateUtterance(seg); // send this utterance's audio to Aqua for the accurate transcript
        } else {
          interim += transcript;
        }
      }
      renderDictation(interim.trim());
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
        // Flush any pending manual edit before restarting so the new instance has the correct baseText
        if (manualEditRef.current !== null) {
          baseText = manualEditRef.current.trimEnd();
          dictBaseRef.current = baseText;
          finalDictatedRef.segs = [];
          manualEditRef.current = null;
        }
        // Chrome kills continuous recognition after silence on desktop; restart automatically
        try { startRecognition(baseText, finalDictatedRef); return; } catch { /* fall through */ }
      }
      // Truly done — stop any open utterance recorder (trailing audio has no
      // final segment to attach to), clear the session cap timer, release the mic
      rotateUtterance(null);
      if (sessionTimerRef.current) { clearTimeout(sessionTimerRef.current); sessionTimerRef.current = null; }
      dictationModeRef.current = "note";
      setAwaitingChapterName(false);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setListening(false);
    };

    rec.start();
    recognitionRef.current = rec;
  }

  function stopDictation() {
    if (sessionTimerRef.current) { clearTimeout(sessionTimerRef.current); sessionTimerRef.current = null; }
    shouldListenRef.current = false;
    dictationModeRef.current = "note";
    setAwaitingChapterName(false);
    recognitionRef.current?.stop?.();
    // mic stream released in onend after recognition fully stops
  }

  async function toggleDictation() {
    if (!speechSupported) return;
    if (listening) {
      stopDictation();
      return;
    }
    setAutoStopped(false);
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

    // High-accuracy re-transcription via Aqua — only while under the $10 cap
    // and only when usage metering loaded successfully (fail closed).
    aquaSessionRef.current =
      aquaReadyRef.current &&
      aquaSecondsRef.current < AQUA_MAX_SECONDS_PER_MONTH &&
      typeof MediaRecorder !== "undefined";
    if (aquaSessionRef.current && micStreamRef.current) beginUtterance(micStreamRef.current);

    // Hard 60-second session cap: the mic never stays open longer than a minute.
    sessionTimerRef.current = setTimeout(() => {
      if (shouldListenRef.current) {
        setAutoStopped(true);
        stopDictation();
      }
    }, 60_000);

    const finalDictatedRef = { segs: [] as DictSeg[] };
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

  // Load this month's Aqua spend. Fails CLOSED: if the usage doc can't be read,
  // Aqua stays disabled — the $10 cap is only guaranteed while metering works.
  useEffect(() => {
    if (!user) return;
    fetchAquaSecondsUsed(user.uid)
      .then((s) => {
        aquaSecondsRef.current = s;
        aquaReadyRef.current = true;
        setAquaSecondsUsed(s);
        setAquaCapped(s >= AQUA_MAX_SECONDS_PER_MONTH);
      })
      .catch((e) => {
        console.error("Aqua usage load failed — high-accuracy dictation disabled:", e);
        aquaReadyRef.current = false;
        setAquaSecondsUsed(null);
      });
  }, [user]);

  async function persist(updated: Book) {
    if (!user) return;
    // Keep the ref in sync synchronously so back-to-back writes in the same
    // tick — e.g. two Aqua clips landing and each patching a saved note — read
    // the latest book instead of a stale one and clobbering each other. The
    // useEffect below stays as the backstop for setBook calls that skip persist.
    bookRef.current = updated;
    setBook(updated);
    await upsertBook(updated);
  }

  function addChapter() {
    const current = bookRef.current;
    if (!current || !chapterInput.trim()) return;
    const num = chapterNumberInput.trim();
    const chapter: Chapter = {
      id: generateId(),
      name: chapterInput.trim(),
      notes: [],
      ...(num ? { number: num } : {}),
    };
    const updated = { ...current, chapters: [...current.chapters, chapter] };
    persist(updated);
    setActiveChapterId(chapter.id);
    setChapterInput("");
    setChapterNumberInput("");
    setAddingChapter(false);
  }

  function deleteChapter(chapterId: string) {
    const current = bookRef.current;
    if (!current) return;
    const chapter = current.chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    if (chapter.notes.length > 0 && !confirm("Delete this chapter? You can restore it later.")) return;
    const updated = { ...current, chapters: current.chapters.map((c) => c.id === chapterId ? { ...c, deleted: true } : c) };
    persist(updated);
    if (activeChapterId === chapterId) {
      const firstAlive = updated.chapters.find((c) => !c.deleted);
      setActiveChapterId(firstAlive?.id ?? null);
    }
  }

  function restoreChapter(chapterId: string) {
    const current = bookRef.current;
    if (!current) return;
    persist({ ...current, chapters: current.chapters.map((c) => c.id === chapterId ? { ...c, deleted: false } : c) });
  }

  function toggleNoteBold(chapterId: string, noteId: string) {
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, bold: !n.bold } : n) }
          : c
      ),
    });
  }

  function openQuiz() {
    if (!book) return;
    setShowAnswer(false);
    if ((book.quizCards?.length ?? 0) > 0) {
      startReview();
    } else {
      setQuizIdx(0);
      setQuizMode("manage");
    }
    setQuizOpen(true);
  }

  function addQuizCard() {
    const current = bookRef.current;
    if (!current) return;
    const question = newQuizQ.trim();
    const answer = newQuizA.trim();
    if (!question || !answer) return;
    const card: QuizCard = { id: generateId(), question, answer, sourceNoteId: newQuizSourceId, ...newSchedule() };
    persist({ ...current, quizCards: [...(current.quizCards ?? []), card] });
    setNewQuizQ("");
    setNewQuizA("");
    setNewQuizSourceId(undefined);
  }

  function deleteQuizCard(cardId: string) {
    const current = bookRef.current;
    if (!current) return;
    persist({ ...current, quizCards: (current.quizCards ?? []).filter((c) => c.id !== cardId) });
  }

  // Freeze a due-first review queue for the session so grading (which changes a
  // card's due date) doesn't reshuffle the list out from under the user.
  function startReview() {
    const cards = bookRef.current?.quizCards ?? [];
    const ordered = [...cards].sort((a, b) => {
      const ad = isDue(a) ? 0 : 1;
      const bd = isDue(b) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return dueSortKey(a).localeCompare(dueSortKey(b));
    });
    setReviewIds(ordered.map((c) => c.id));
    setQuizIdx(0);
    setShowAnswer(false);
    setQuizMode("review");
  }

  // Apply a spaced-repetition grade to a card and reschedule it.
  function gradeCard(cardId: string, grade: Grade) {
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      quizCards: (current.quizCards ?? []).map((c) => (c.id === cardId ? schedule(c, grade) : c)),
    });
  }

  // Promote a note into a flashcard: prefill the note text as the answer and let
  // the user write the recall cue (the generation effect strengthens memory).
  function makeFlashcardFromNote(note: Note) {
    if (listening) stopDictation();
    setNewQuizSourceId(note.id);
    setNewQuizA(note.text);
    setNewQuizQ("");
    setQuizMode("manage");
    setQuizOpen(true);
  }

  // Note-level tags (lowercased, de-duped) for cross-book clustering.
  function updateNoteTags(chapterId: string, noteId: string, tags: string[]) {
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, tags: tags.length ? tags : undefined } : n)) }
          : c,
      ),
    });
  }

  function addNoteTag(chapterId: string, note: Note, raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    const existing = note.tags ?? [];
    if (existing.includes(tag)) return;
    updateNoteTags(chapterId, note.id, [...existing, tag]);
  }

  function removeNoteTag(chapterId: string, note: Note, tag: string) {
    updateNoteTags(chapterId, note.id, (note.tags ?? []).filter((t) => t !== tag));
  }

  function saveTakeaway() {
    const current = bookRef.current;
    if (!current) return;
    persist({ ...current, takeaway: takeawayDraft.trim() || undefined });
    setEditingTakeaway(false);
  }

  function saveChapterName(chapterId: string) {
    const current = bookRef.current;
    if (!current || !editingChapterName.trim()) return;
    const num = editingChapterNumber.trim();
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, name: editingChapterName.trim(), number: num || undefined }
          : c
      ),
    });
    setEditingChapterId(null);
  }

  async function addNote(textOverride?: string) {
    if (!book || !activeChapterId) return;

    // Add button / Enter pressed mid-dictation: finalize the current spoken
    // note through the segment path (saves instantly, lets Aqua patch it),
    // and clear the live dictation state so no stale audio repaints the field.
    if (textOverride === undefined && listening && dictSegsRef.current) {
      const segs = dictSegsRef.current.segs;
      const base = dictBaseRef.current;
      dictBaseRef.current = "";
      dictSegsRef.current.segs = [];
      setNoteInput("");
      noteInputRef.current?.focus();
      commitNote(base, segs);
      return;
    }

    const targetChapterId = activeChapterId;
    let text = (textOverride ?? noteInput).trim();
    if (!text) return;

    cameFromDictationRef.current = false;
    setNoteInput("");
    noteInputRef.current?.focus();

    // Strip any stray "new/next bullet" voice commands
    text = text.replace(/\b(?:new|next)\s+bullet\b[\s.,!?]*/gi, "").trim();
    if (!text) return;

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

  // Same, for commitNote — the long-lived speech callback must use the latest
  // closure so it targets the current chapter / indent / type.
  const commitNoteRef = useRef(commitNote);
  useEffect(() => { commitNoteRef.current = commitNote; });

  function addChapterFromVoice(number: string, name: string) {
    const current = bookRef.current;
    if (!current || !name.trim()) return;
    const chapter: Chapter = {
      id: generateId(),
      name: name.trim(),
      notes: [],
      ...(number ? { number } : {}),
    };
    const updated = { ...current, chapters: [...current.chapters, chapter] };
    persist(updated);
    setActiveChapterId(chapter.id);
  }
  const addChapterFromVoiceRef = useRef(addChapterFromVoice);
  useEffect(() => { addChapterFromVoiceRef.current = addChapterFromVoice; });

  function changeNoteIndent(chapterId: string, noteId: string, delta: number) {
    const current = bookRef.current;
    if (!current) return;
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, indent: Math.max(0, Math.min(2, (n.indent ?? 0) + delta)) } : n) }
          : c
      ),
    });
  }

  function deleteNote(chapterId: string, noteId: string) {
    const current = bookRef.current;
    if (!current) return;
    noteSegsRef.current.delete(noteId); // cancel any pending Aqua patch
    persist({ ...current, chapters: current.chapters.map((c) => c.id === chapterId ? { ...c, notes: c.notes.filter((n) => n.id !== noteId) } : c) });
  }

  function reorderNote(chapterId: string, fromId: string, toId: string) {
    const current = bookRef.current;
    if (!current || fromId === toId) return;
    const chapter = current.chapters.find((c) => c.id === chapterId);
    if (!chapter) return;
    const notes = [...chapter.notes];
    const fromIdx = notes.findIndex((n) => n.id === fromId);
    const toIdx = notes.findIndex((n) => n.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = notes.splice(fromIdx, 1);
    notes.splice(toIdx, 0, moved);
    persist({ ...current, chapters: current.chapters.map((c) => c.id === chapterId ? { ...c, notes } : c) });
  }

  function moveNoteToChapter(fromChapterId: string, noteId: string, toChapterId: string) {
    const current = bookRef.current;
    if (!current || fromChapterId === toChapterId) return;
    const note = current.chapters.find((c) => c.id === fromChapterId)?.notes.find((n) => n.id === noteId);
    if (!note) return;
    // Re-home any pending Aqua patch so a late clip lands in the new chapter
    // instead of the old one (patchSavedNote matches on entry.chapterId).
    const entry = noteSegsRef.current.get(noteId);
    if (entry) entry.chapterId = toChapterId;
    persist({
      ...current,
      chapters: current.chapters.map((c) => {
        if (c.id === fromChapterId) return { ...c, notes: c.notes.filter((n) => n.id !== noteId) };
        if (c.id === toChapterId) return { ...c, notes: [...c.notes, note] };
        return c;
      }),
    });
  }

  function saveNoteEdit(chapterId: string, noteId: string) {
    const current = bookRef.current;
    if (!current || !editingNoteText.trim()) return;
    noteSegsRef.current.delete(noteId); // your edit wins over any pending Aqua patch
    persist({
      ...current,
      chapters: current.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, notes: c.notes.map((n) => n.id === noteId ? { ...n, text: editingNoteText.trim(), indent: editingNoteIndent, type: editingNoteType, bold: editingNoteBold } : n) }
          : c
      ),
    });
    setEditingNoteId(null);
  }

  const searchResults: SearchResult[] = [];
  if (book && search.trim()) {
    const q = search.toLowerCase();
    for (const chapter of book.chapters.filter((c) => !c.deleted)) {
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

  const activeChapter = book?.chapters.find((c) => c.id === activeChapterId && !c.deleted);

  // How many of this book's cards are due for review right now.
  const dueCount = (book?.quizCards ?? []).filter((c) => isDue(c)).length;

  // Tag suggestions for the note currently having its tags edited: this book's
  // book-level tags plus any tag already used on another note, biased to those
  // whose word appears in the note's text — cheap keyword auto-suggest.
  function tagSuggestions(note: Note): string[] {
    if (!book) return [];
    const applied = new Set(note.tags ?? []);
    const pool = new Set<string>(book.tags ?? []);
    for (const c of book.chapters) for (const n of c.notes) for (const t of n.tags ?? []) pool.add(t);
    const text = note.text.toLowerCase();
    return [...pool]
      .filter((t) => !applied.has(t))
      .sort((a, b) => Number(text.includes(b)) - Number(text.includes(a)))
      .slice(0, 6);
  }

  // #7 related notes across books: notes from OTHER books that share a tag with
  // this book (book-level or note-level), so ideas cluster across your library.
  const thisBookTags = new Set<string>([
    ...(book?.tags ?? []),
    ...(book?.chapters.flatMap((c) => c.notes.flatMap((n) => n.tags ?? [])) ?? []),
  ]);
  const relatedNotes = thisBookTags.size === 0 || !book
    ? []
    : books
        .filter((b) => b.id !== book.id)
        .flatMap((b) =>
          b.chapters
            .filter((c) => !c.deleted)
            .flatMap((c) =>
              c.notes
                .filter((n) => {
                  const noteTags = new Set([...(n.tags ?? []), ...(b.tags ?? [])]);
                  return [...noteTags].some((t) => thisBookTags.has(t));
                })
                .map((n) => ({ note: n, book: b }))
            )
        )
        .slice(0, 6);

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
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
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
                onChange={(e) => { const current = bookRef.current; if (current) persist({ ...current, dateCompleted: e.target.value || undefined }); }}
                className="text-xs border border-parchment-300 rounded px-2 py-1 text-ink-700 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
              />
              {book.dateCompleted && (
                <button
                  onClick={() => { const current = bookRef.current; if (current) persist({ ...current, dateCompleted: undefined }); }}
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
            <button
              onClick={openQuiz}
              className="flex items-center gap-1.5 border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              title="Quiz yourself on this book"
            >
              🎓 Quiz
              {dueCount > 0 && (
                <span className="bg-amber-600 text-white text-[10px] font-semibold rounded-full px-1.5 leading-tight">{dueCount}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {search.trim() && (
        <div className="border-b border-parchment-300 bg-white px-6 py-4">
          <div className="max-w-screen-2xl mx-auto">
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

      <div className="flex flex-1 min-h-0 max-w-screen-2xl mx-auto w-full">
        {/* Sidebar — collapsed: thin vertical tab; expanded: full chapter list */}
        {!sidebarOpen ? (
          <aside className="w-9 flex-shrink-0 border-r border-parchment-300 bg-parchment-100">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-full h-full flex items-center justify-center hover:bg-parchment-200 transition-colors py-4"
              title="Show chapters"
            >
              <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-medium text-ink-500 uppercase tracking-wider whitespace-nowrap">
                Chapters · {book.chapters.filter((c) => !c.deleted).length}
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
            {book.chapters.filter((c) => !c.deleted).length === 0 && !addingChapter && (
              <p className="text-ink-300 text-xs italic px-4 py-3">No chapters yet.</p>
            )}
            {book.chapters.filter((c) => !c.deleted).map((chapter) => (
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
                    <button onClick={() => exportChapterMarkdown(chapter, book.title)}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-ink-700 hover:bg-parchment-300"}`}
                      title="Export chapter as Markdown">↓</button>
                    <button onClick={() => { setEditingChapterId(chapter.id); setEditingChapterName(chapter.name); setEditingChapterNumber(chapter.number ?? ""); }}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-ink-700 hover:bg-parchment-300"}`}>✎</button>
                    <button onClick={() => deleteChapter(chapter.id)}
                      className={`p-1 rounded text-xs ${activeChapterId === chapter.id ? "text-amber-100 hover:text-white hover:bg-amber-500" : "text-ink-300 hover:text-red-500 hover:bg-parchment-300"}`}>×</button>
                  </div>
                )}
              </div>
            ))}
            {/* Deleted chapters section */}
            {book.chapters.some((c) => c.deleted) && (
              <div className="mt-2 border-t border-parchment-200 pt-2">
                <button
                  onClick={() => setShowDeleted((v) => !v)}
                  className="w-full text-left px-4 py-1.5 text-xs font-medium text-ink-300 hover:text-ink-500 uppercase tracking-wide flex items-center gap-1"
                >
                  <span>{showDeleted ? "▾" : "▸"}</span> Deleted chapters ({book.chapters.filter((c) => c.deleted).length})
                </button>
                {showDeleted && book.chapters.filter((c) => c.deleted).map((chapter) => (
                  <div key={chapter.id} className="flex items-center justify-between px-4 py-1.5 gap-2">
                    <span className="text-xs text-ink-300 truncate italic">{chapter.name}</span>
                    <button
                      onClick={() => restoreChapter(chapter.id)}
                      className="flex-shrink-0 text-xs text-amber-600 hover:text-amber-500 font-medium"
                    >Restore</button>
                  </div>
                ))}
              </div>
            )}
          </nav>
        </aside>
        )}

        {/* Main content */}
        <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {/* Book takeaway — distilled one-line summary (progressive summarization) */}
          <div className="px-8 pt-4">
            {editingTakeaway ? (
              <div className="flex items-start gap-2">
                <textarea
                  autoFocus
                  rows={2}
                  value={takeawayDraft}
                  onChange={(e) => setTakeawayDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTakeaway(); }
                    if (e.key === "Escape") setEditingTakeaway(false);
                  }}
                  placeholder="Distill this book to one takeaway…"
                  className="flex-1 border border-amber-500 rounded-lg px-3 py-2 text-sm text-ink-900 focus:outline-none bg-white resize-y leading-snug"
                />
                <button onClick={saveTakeaway} className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors flex-shrink-0">Save</button>
              </div>
            ) : book.takeaway ? (
              <button
                onClick={() => { setTakeawayDraft(book.takeaway ?? ""); setEditingTakeaway(true); }}
                className="group w-full text-left flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
              >
                <span className="text-amber-500 mt-0.5">✦</span>
                <span className="flex-1 text-sm text-ink-800 italic leading-snug">{book.takeaway}</span>
                <span className="opacity-0 group-hover:opacity-100 text-ink-300 text-xs flex-shrink-0">✎</span>
              </button>
            ) : (
              <button
                onClick={() => { setTakeawayDraft(""); setEditingTakeaway(true); }}
                className="text-xs text-ink-300 hover:text-amber-600 transition-colors"
              >✦ Add a takeaway</button>
            )}
          </div>
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
                {(() => {
                  if (activeChapter.notes.length === 0) {
                    return <p className="text-ink-300 text-sm italic">No notes yet. Add your first note below.</p>;
                  }
                  const numMap = buildNumberMap(activeChapter.notes);

                  // Group consecutive notes by type so bullets always render single-column
                  type NoteGroup = { type: "bullet" | "numbered"; notes: typeof activeChapter.notes };
                  const groups: NoteGroup[] = [];
                  for (const note of activeChapter.notes) {
                    const t = (note.type ?? "bullet") === "numbered" ? "numbered" : "bullet";
                    if (groups.length > 0 && groups[groups.length - 1].type === t) {
                      groups[groups.length - 1].notes.push(note);
                    } else {
                      groups.push({ type: t, notes: [note] });
                    }
                  }

                  const renderNote = (note: typeof activeChapter.notes[0], cols: number) => {
                    const level = Math.min(note.indent ?? 0, 2);
                    const isNumbered = (note.type ?? "bullet") === "numbered";
                    const marker = isNumbered ? `${numMap.get(note.id)}.` : BULLET_CHAR[level];
                    const isDragTarget = dragOverNoteId === note.id && dragNoteId !== note.id;
                    return (
                      <li
                        key={note.id}
                        className={`group relative flex items-start gap-2${cols > 1 ? " break-inside-avoid mb-1" : ""}${isDragTarget ? " border-t-2 border-amber-400" : " border-t-2 border-transparent"}`}
                        style={{ paddingLeft: INDENT_PX[level] }}
                        onDragEnter={(e) => { e.preventDefault(); }}
                        onDragOver={(e) => { e.preventDefault(); if (dragNoteIdRef.current && dragNoteIdRef.current !== note.id) setDragOverNoteId(note.id); }}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverNoteId(null); }}
                        onDrop={(e) => { e.preventDefault(); const from = dragNoteIdRef.current; if (from && from !== note.id) reorderNote(activeChapter.id, from, note.id); dragNoteIdRef.current = null; setDragNoteId(null); setDragOverNoteId(null); }}
                      >
                        <span
                          draggable={editingNoteId !== note.id}
                          onDragStart={(e) => { dragNoteIdRef.current = note.id; setDragNoteId(note.id); e.dataTransfer.effectAllowed = "move"; const li = e.currentTarget.closest("li"); if (li) e.dataTransfer.setDragImage(li, 20, 10); }}
                          onDragEnd={() => { dragNoteIdRef.current = null; setDragNoteId(null); setDragOverNoteId(null); }}
                          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing mt-1 flex-shrink-0 text-ink-200 hover:text-ink-400 select-none text-xs leading-none"
                          title="Drag to reorder"
                        >⠿</span>
                        <span className={`mt-0.5 flex-shrink-0 text-sm leading-tight select-none min-w-[1.25rem] text-right ${BULLET_COLOR[level]}`}>
                          {marker}
                        </span>
                        {editingNoteId === note.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <button
                              onClick={() => setEditingNoteType((t) => t === "bullet" ? "numbered" : "bullet")}
                              className="flex-shrink-0 text-xs border border-parchment-300 rounded px-1.5 py-0.5 text-ink-500 hover:border-amber-500 hover:text-amber-600 transition-colors"
                              title={editingNoteType === "numbered" ? "Convert to bullet" : "Convert to numbered"}
                            >
                              {editingNoteType === "numbered" ? "→ •" : "→ 1."}
                            </button>
                            <button
                              onClick={() => setEditingNoteBold((b) => !b)}
                              className={`flex-shrink-0 text-xs border rounded px-1.5 py-0.5 font-bold transition-colors ${editingNoteBold ? "border-amber-500 bg-amber-50 text-amber-700" : "border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600"}`}
                              title="Toggle bold"
                            >
                              B
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
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm leading-relaxed ${note.bold ? "font-bold text-ink-900" : "text-ink-800"}`}>{note.text}</span>
                            {((note.tags?.length ?? 0) > 0 || tagEditNoteId === note.id) && (
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {(note.tags ?? []).map((t) => (
                                  <span key={t} className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[11px] font-medium px-1.5 py-0.5 rounded-full">
                                    {t}
                                    <button onClick={() => removeNoteTag(activeChapter.id, note, t)} className="hover:text-amber-900 leading-none">×</button>
                                  </span>
                                ))}
                                {tagEditNoteId === note.id && (
                                  <>
                                    <input
                                      autoFocus
                                      value={tagDraft}
                                      onChange={(e) => setTagDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addNoteTag(activeChapter.id, note, tagDraft); setTagDraft(""); }
                                        if (e.key === "Escape") { setTagEditNoteId(null); setTagDraft(""); }
                                      }}
                                      onBlur={() => { addNoteTag(activeChapter.id, note, tagDraft); setTagDraft(""); setTagEditNoteId(null); }}
                                      placeholder="tag…"
                                      className="text-[11px] border border-amber-300 rounded-full px-2 py-0.5 w-20 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    />
                                    {tagSuggestions(note).map((s) => (
                                      <button
                                        key={s}
                                        onMouseDown={(e) => { e.preventDefault(); addNoteTag(activeChapter.id, note, s); }}
                                        className="text-[11px] text-ink-400 hover:text-amber-600 border border-dashed border-parchment-300 rounded-full px-1.5 py-0.5"
                                      >+ {s}</button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {editingNoteId !== note.id && (
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                            <button onClick={() => changeNoteIndent(activeChapter.id, note.id, -1)} disabled={level === 0}
                              className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Outdent">←</button>
                            <button onClick={() => changeNoteIndent(activeChapter.id, note.id, 1)} disabled={level === 2}
                              className="text-ink-300 hover:text-ink-700 disabled:opacity-20 text-xs px-1 py-0.5 rounded hover:bg-parchment-200" title="Indent">→</button>
                            <button onClick={() => toggleNoteBold(activeChapter.id, note.id)}
                              className={`text-xs px-1 py-0.5 rounded font-bold hover:bg-parchment-200 ${note.bold ? "text-amber-600 hover:text-amber-700" : "text-ink-300 hover:text-ink-700"}`}
                              title="Toggle bold">B</button>
                            <button
                              onClick={() => { const current = bookRef.current; if (current) persist({ ...current, chapters: current.chapters.map((c) => c.id === activeChapter.id ? { ...c, notes: c.notes.map((n) => n.id === note.id ? { ...n, type: isNumbered ? "bullet" : "numbered" } : n) } : c) }); }}
                              className="text-ink-300 hover:text-amber-600 text-xs px-1 py-0.5 rounded hover:bg-parchment-200"
                              title={isNumbered ? "Convert to bullet" : "Convert to numbered"}
                            >{isNumbered ? "•" : "1."}</button>
                            <button onClick={() => { setTagEditNoteId(tagEditNoteId === note.id ? null : note.id); setTagDraft(""); }}
                              className={`text-xs px-1 py-0.5 rounded hover:bg-parchment-200 ${(note.tags?.length ?? 0) > 0 ? "text-amber-600" : "text-ink-300 hover:text-ink-700"}`}
                              title="Tags">🏷</button>
                            <button onClick={() => makeFlashcardFromNote(note)}
                              className="text-xs px-1 py-0.5 rounded hover:bg-parchment-200 text-ink-300 hover:text-amber-600"
                              title="Make flashcard">❓</button>
                            <button onClick={() => { if (listening) stopDictation(); setEditingNoteId(note.id); setEditingNoteText(note.text); setEditingNoteIndent(level); setEditingNoteType(note.type ?? "bullet"); setEditingNoteBold(note.bold ?? false); }}
                              className="text-ink-300 hover:text-ink-700 text-xs p-0.5">✎</button>
                            <button onClick={() => deleteNote(activeChapter.id, note.id)}
                              className="text-ink-300 hover:text-red-500 text-sm p-0.5 leading-none">×</button>
                            <select
                              value=""
                              onChange={(e) => { if (e.target.value) moveNoteToChapter(activeChapter.id, note.id, e.target.value); }}
                              className="text-ink-300 text-xs bg-transparent border-none cursor-pointer rounded hover:bg-parchment-200 py-0.5 max-w-[3rem]"
                              title="Move to chapter"
                            >
                              <option value="" disabled>↗</option>
                              {book.chapters.filter((c) => !c.deleted && c.id !== activeChapter.id).map((c) => (
                                <option key={c.id} value={c.id}>{c.number ? `${c.number}. ${c.name}` : c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </li>
                    );
                  };

                  return (
                    <div className="space-y-1">
                      {groups.map((group, gi) => {
                        const c = group.type === "numbered"
                          ? (group.notes.length > 50 ? 4 : group.notes.length > 25 ? 3 : group.notes.length > 10 ? 2 : 1)
                          : 1;
                        const ulCls = c === 4 ? "columns-4 gap-x-6" : c === 3 ? "columns-3 gap-x-6" : c === 2 ? "columns-2 gap-x-6" : "space-y-1";
                        return <ul key={gi} className={ulCls}>{group.notes.map(n => renderNote(n, c))}</ul>;
                      })}
                    </div>
                  );
                })()}

                {/* #7 Related notes from other books sharing a tag */}
                {relatedNotes.length > 0 && (
                  <div className="mt-8 pt-5 border-t border-parchment-200">
                    <p className="text-xs font-medium text-ink-300 uppercase tracking-wide mb-3">🔗 Related across your library</p>
                    <div className="space-y-2">
                      {relatedNotes.map(({ note, book: rb }) => (
                        <button
                          key={note.id}
                          onClick={() => router.push(`/book/${rb.id}`)}
                          className="block w-full text-left bg-parchment-50 border border-parchment-200 rounded-lg px-3 py-2 hover:border-amber-500 transition-colors"
                        >
                          <p className={`text-sm text-ink-800 leading-snug ${note.bold ? "font-bold" : ""}`}>{note.text}</p>
                          <p className="text-xs text-ink-300 mt-0.5 italic">— {rb.title}</p>
                        </button>
                      ))}
                    </div>
                  </div>
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
                        cameFromDictationRef.current = false;
                        if (listening) {
                          // Manual typing takes over — turn the mic off.
                          // Preserve what was typed if a final result races the stop.
                          manualEditRef.current = e.target.value;
                          stopDictation();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") { e.preventDefault(); setNoteIndent((i) => e.shiftKey ? Math.max(0, i - 1) : Math.min(2, i + 1)); }
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); }
                      }}
                      placeholder={awaitingChapterName ? "Say chapter name, e.g. \"1 Introduction\"…" : `Add a ${noteType === "numbered" ? "numbered" : "bullet"} note… (Tab to indent)`}
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
                        aria-label={listening ? "Stop dictation" : "Dictate note"}
                        aria-pressed={listening}
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
                {(aquaSecondsUsed !== null || autoStopped || aquaCapped) && (
                  <p className="text-xs mt-1.5 ml-20" aria-live="polite">
                    {aquaSecondsUsed !== null && (
                      <span className="text-ink-300">
                        Aqua HD voice: ${aquaSpendUsd(aquaSecondsUsed).toFixed(2)} of ${AQUA_MONTHLY_CAP_USD}.00 this month
                        {aquaCapped ? " — budget reached, free dictation until next month" : ""}
                      </span>
                    )}
                    {autoStopped && (
                      <span className="text-amber-600"> · Mic auto-stopped after 60s — tap 🎤 to continue</span>
                    )}
                  </p>
                )}
                <p className="text-xs text-ink-300 mt-1.5 ml-20">
                  Tab = indent · Shift+Tab = outdent · Enter = add
                  {speechSupported && ` · 🎤 = dictate · ${awaitingChapterName ? "now say chapter name…" : "\"new/next bullet\" · \"new chapter\" · \"indent\" / \"outdent\""}`}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Quiz modal — manual flashcards */}
      {quizOpen && book && (() => {
        const cards = book.quizCards ?? [];
        return (
          <div className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-parchment-100 rounded-lg p-0.5">
                  <button
                    onClick={startReview}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${quizMode === "review" ? "bg-white text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-700"}`}
                  >🎓 Review</button>
                  <button
                    onClick={() => setQuizMode("manage")}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${quizMode === "manage" ? "bg-white text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-700"}`}
                  >✎ Cards ({cards.length})</button>
                </div>
                <button onClick={() => setQuizOpen(false)} className="text-ink-300 hover:text-ink-700 text-lg leading-none">×</button>
              </div>

              {quizMode === "review" ? (() => {
                const queue = reviewIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as QuizCard[];
                const reviewCard = queue[quizIdx];
                if (cards.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-ink-400 text-sm italic mb-3">No quiz cards yet.</p>
                      <button onClick={() => setQuizMode("manage")} className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">Add cards</button>
                    </div>
                  );
                }
                if (!reviewCard) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-3xl mb-2">🎉</p>
                      <p className="text-ink-500 text-sm mb-4">
                        Review complete{queue.length > 0 ? ` — ${queue.length} card${queue.length !== 1 ? "s" : ""} done` : ""}.
                      </p>
                      <button onClick={startReview} className="border border-parchment-300 text-ink-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-parchment-100 transition-colors">Review again</button>
                    </div>
                  );
                }
                return (
                  <>
                    <span className="text-xs font-medium text-ink-300 uppercase tracking-wide">
                      Card {quizIdx + 1} of {queue.length}{dueCount > 0 ? ` · ${dueCount} due` : ""}
                    </span>
                    <p className="font-serif text-ink-900 text-lg leading-snug">{reviewCard.question}</p>
                    {showAnswer ? (
                      <>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-ink-800 whitespace-pre-wrap">{reviewCard.answer}</div>
                        <div className="grid grid-cols-4 gap-2 mt-2">
                          {([
                            ["again", "Again", "text-red-600 border-red-200 hover:bg-red-50"],
                            ["hard", "Hard", "text-amber-700 border-amber-200 hover:bg-amber-50"],
                            ["good", "Good", "text-green-700 border-green-200 hover:bg-green-50"],
                            ["easy", "Easy", "text-blue-700 border-blue-200 hover:bg-blue-50"],
                          ] as const).map(([g, label, cls]) => (
                            <button
                              key={g}
                              onClick={() => { gradeCard(reviewCard.id, g); setShowAnswer(false); setQuizIdx((i) => i + 1); }}
                              className={`text-xs font-medium py-2 rounded-lg border bg-white transition-colors ${cls}`}
                            >{label}</button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <button onClick={() => setShowAnswer(true)} className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">Reveal Answer</button>
                    )}
                    <button onClick={() => { setShowAnswer(false); setQuizIdx((i) => i + 1); }} className="text-xs text-ink-300 hover:text-ink-600 mt-1 self-start">Skip →</button>
                  </>
                );
              })() : (
                <>
                  <div className="space-y-2">
                    <input
                      value={newQuizQ}
                      onChange={(e) => setNewQuizQ(e.target.value)}
                      placeholder="Question"
                      className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                    <textarea
                      value={newQuizA}
                      onChange={(e) => setNewQuizA(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addQuizCard(); }}
                      placeholder="Answer (Ctrl/⌘+Enter to add)"
                      rows={2}
                      className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y"
                    />
                    <button
                      onClick={addQuizCard}
                      disabled={!newQuizQ.trim() || !newQuizA.trim()}
                      className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
                    >+ Add card</button>
                  </div>
                  {cards.length > 0 && (
                    <ul className="space-y-1.5 border-t border-parchment-100 pt-3">
                      {cards.map((c) => (
                        <li key={c.id} className="flex items-start justify-between gap-2 text-sm group">
                          <div className="min-w-0">
                            <p className="text-ink-800 font-medium truncate">{c.question}</p>
                            <p className="text-ink-400 text-xs truncate">{c.answer}</p>
                          </div>
                          <button onClick={() => deleteQuizCard(c.id)} className="opacity-0 group-hover:opacity-100 text-ink-300 hover:text-red-500 transition-all flex-shrink-0 leading-none">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
