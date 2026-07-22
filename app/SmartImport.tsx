"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useBooks } from "@/context/BooksContext";
import {
  SMART_IMPORT_MAX_CHARS,
  type SmartImportAnswer,
  type SmartImportQuestion,
} from "@/lib/smartImport";
import { countNotes, toBook, type ParsedBook } from "@/lib/importBook";


/**
 * Smart Import — a document in, book notes out.
 *
 * The model may ask before committing; answers are replayed on the next round
 * and the loop is capped server-side. The result lands in a preview, never
 * straight into the library, so a bad parse costs a click to discard.
 */
export function SmartImport({ onDone }: { onDone?: () => void } = {}) {
  const { user } = useAuth();
  const { upsertBook } = useBooks();
  const router = useRouter();

  const fileRef = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [questions, setQuestions] = useState<SmartImportQuestion[] | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ book: ParsedBook; assumptions: string[] } | null>(null);

  const tooLong = document.length > SMART_IMPORT_MAX_CHARS;

  async function analyze(answers: SmartImportAnswer[], nextRound: number) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/smart-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ document, answers, round: nextRound }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setRound(nextRound);
      if (body.status === "questions") {
        setQuestions(body.questions as SmartImportQuestion[]);
        setPreview(null);
      } else {
        setQuestions(null);
        setPreview({ book: body.book as ParsedBook, assumptions: body.assumptions ?? [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submitAnswers() {
    if (!questions) return;
    const answers: SmartImportAnswer[] = questions
      .map((q) => ({ question: q.question, answer: (replies[q.id] ?? "").trim() }))
      .filter((a) => a.answer);
    if (answers.length === 0) return;
    void analyze(answers, round + 1);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    try {
      const book = toBook(preview.book);
      await upsertBook(book);
      setPreview(null);
      setDocument("");
      setRound(0);
      onDone?.();
      router.push(`/book/${book.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-parchment-200 rounded-xl p-5">
      <h2 className="font-serif font-semibold text-ink-900">Smart Import</h2>
      <p className="text-xs text-ink-300 mt-0.5 mb-3">
        Paste a chapter, an article, or exported highlights — the AI turns it into notes. It may ask
        a question or two first.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
        >
          Choose file (.md / .txt)
        </button>
        {fileName && <span className="text-xs text-ink-300 truncate">{fileName}</span>}
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setDocument(await file.text());
            setQuestions(null);
            setPreview(null);
            setError(null);
          }}
        />
      </div>

      <textarea
        value={document}
        onChange={(e) => { setDocument(e.target.value); setFileName(undefined); }}
        rows={5}
        placeholder="Paste the document here, or choose a file…"
        className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y"
      />
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          onClick={() => { setQuestions(null); setPreview(null); void analyze([], 0); }}
          disabled={busy || !document.trim() || tooLong}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {busy ? "Reading…" : "✨ Analyze"}
        </button>
        <span className={`text-xs ${tooLong ? "text-red-600" : "text-ink-300"}`}>
          {document.length.toLocaleString()} / {SMART_IMPORT_MAX_CHARS.toLocaleString()} characters
          {tooLong && " — import a chapter at a time"}
        </span>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {questions && (
        <div className="mt-4 border-t border-parchment-200 pt-4">
          <p className="text-sm text-ink-700 mb-3">A couple of things before I convert this:</p>
          <div className="flex flex-col gap-3">
            {questions.map((q) => (
              <div key={q.id}>
                <p className="text-sm text-ink-900 mb-1">{q.question}</p>
                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((option) => (
                      <button
                        key={option}
                        onClick={() => setReplies((prev) => ({ ...prev, [q.id]: option }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          replies[q.id] === option
                            ? "bg-amber-600 border-amber-600 text-white"
                            : "bg-white border-parchment-300 text-ink-500 hover:border-amber-500"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    value={replies[q.id] ?? ""}
                    onChange={(e) => setReplies((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    className="w-full border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                )}
              </div>
            ))}
          </div>
          <button
            onClick={submitAnswers}
            disabled={busy}
            className="mt-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {preview && (
        <div className="mt-4 border-t border-parchment-200 pt-4">
          <p className="font-serif text-ink-900">
            {preview.book.title}
            {preview.book.author ? <span className="text-ink-500"> — {preview.book.author}</span> : null}
          </p>
          <p className="text-xs text-ink-300 mt-0.5">
            {preview.book.chapters.length} chapter
            {preview.book.chapters.length === 1 ? "" : "s"} · {countNotes(preview.book)} notes
          </p>

          {preview.assumptions.length > 0 && (
            <div className="mt-3 bg-parchment-50 border border-parchment-200 rounded-lg p-3">
              <p className="text-xs uppercase tracking-wide text-ink-300 mb-1">Assumed</p>
              <ul className="text-xs text-ink-700 list-disc list-inside">
                {preview.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-3 max-h-64 overflow-y-auto flex flex-col gap-3">
            {preview.book.chapters.map((c) => (
              <div key={c.id}>
                <p className="text-sm font-medium text-ink-900">
                  {c.number ? `${c.number}. ` : ""}{c.name}
                </p>
                <ul className="mt-1">
                  {c.notes.map((n) => (
                    <li
                      key={n.id}
                      className={`text-sm text-ink-500 ${n.bold ? "font-medium text-ink-900" : ""}`}
                      style={{ paddingLeft: `${n.indent * 16}px` }}
                    >
                      • {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={save}
              disabled={busy}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {busy ? "Saving…" : "Add to library"}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="text-sm text-ink-500 hover:text-ink-700 transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
