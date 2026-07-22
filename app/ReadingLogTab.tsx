"use client";

import { useRef, useState } from "react";
import { useBooks } from "@/context/BooksContext";
import { bookStatus } from "@/lib/types";
import { groupLogRowsByBook, parseReadingLogCsv, type ParsedLogResult } from "@/lib/readingLog";

/**
 * Reading Log — where pages get entered.
 *
 * The totals still live on the Dashboard; only the input moved here, so the
 * dashboard stays something you read rather than something you fill in.
 */
export function ReadingLogTab() {
  const { books, upsertBook } = useBooks();
  const todayStr = new Date().toISOString().split("T")[0];
  const fileRef = useRef<HTMLInputElement>(null);

  const [logBookId, setLogBookId] = useState("");
  const [logDate, setLogDate] = useState(todayStr);
  const [logPages, setLogPages] = useState("");
  const [saving, setSaving] = useState(false);
  const [csv, setCsv] = useState<ParsedLogResult | null>(null);
  const [csvName, setCsvName] = useState<string | undefined>(undefined);
  const [imported, setImported] = useState(0);

  const readable = books.filter((b) => bookStatus(b) !== "wishlist");

  const recent = books
    .flatMap((b) => (b.readingLog ?? []).map((e) => ({ ...e, bookTitle: b.title })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);

  async function addEntry() {
    const book = books.find((b) => b.id === logBookId);
    const pages = Number(logPages);
    if (!book || !Number.isFinite(pages) || pages <= 0 || !logDate) return;
    setSaving(true);
    try {
      await upsertBook({
        ...book,
        readingLog: [...(book.readingLog ?? []), { date: logDate, pages: Math.round(pages) }],
      });
      setLogPages("");
    } finally {
      setSaving(false);
    }
  }

  async function importCsv() {
    if (!csv || csv.rows.length === 0) return;
    setSaving(true);
    try {
      // Group first so a book with twenty rows is written once rather than
      // twenty times — saveBook rewrites the whole document on every call.
      const grouped = groupLogRowsByBook(csv.rows);
      for (const [bookId, entries] of grouped) {
        const book = books.find((b) => b.id === bookId);
        if (!book) continue;
        await upsertBook({ ...book, readingLog: [...(book.readingLog ?? []), ...entries] });
      }
      setImported(csv.rows.length);
      setCsv(null);
      setCsvName(undefined);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-parchment-200 rounded-xl p-5">
        <h2 className="font-serif font-semibold text-ink-900 mb-3">Log pages read</h2>
        {readable.length === 0 ? (
          <p className="text-sm text-ink-300">Add a book you are reading first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <select
              value={logBookId}
              onChange={(e) => setLogBookId(e.target.value)}
              className="flex-1 min-w-[12rem] border border-parchment-300 rounded-lg px-3 py-2 text-sm text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="">Select book…</option>
              {readable.map((b) => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="border border-parchment-300 rounded-lg px-2 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <input
              type="number"
              min="1"
              value={logPages}
              onChange={(e) => setLogPages(e.target.value)}
              placeholder="Pages"
              className="w-24 border border-parchment-300 rounded-lg px-2 py-2 text-sm text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <button
              onClick={addEntry}
              disabled={!logBookId || !logPages || !logDate || saving}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Add
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border border-parchment-200 rounded-xl p-5">
        <h2 className="font-serif font-semibold text-ink-900">Upload a CSV</h2>
        <p className="text-xs text-ink-500 mb-3 leading-relaxed">
          Header row with <code>Book</code>, <code>Date</code> and <code>Pages</code> columns, in any
          order. Books are matched by title against your library; dates can be{" "}
          <code>YYYY-MM-DD</code> or <code>M/D/YYYY</code>. Rows that do not match are listed rather
          than skipped quietly.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="border border-parchment-300 text-ink-500 hover:border-amber-500 hover:text-amber-600 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          >
            Choose file (.csv)
          </button>
          {csvName && <span className="text-xs text-ink-300 truncate">{csvName}</span>}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setCsvName(file.name);
              setImported(0);
              setCsv(parseReadingLogCsv(await file.text(), books));
            }}
          />
        </div>

        {imported > 0 && <p className="text-sm text-ink-700 mt-3">Added {imported} entries.</p>}

        {csv && (
          <div className="mt-3">
            {csv.rows.length > 0 && (
              <>
                <p className="text-sm text-ink-700">
                  {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"} ready ·{" "}
                  {csv.rows.reduce((s, r) => s + r.entry.pages, 0).toLocaleString()} pages
                </p>
                <button
                  onClick={importCsv}
                  disabled={saving}
                  className="mt-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {saving ? "Adding…" : "Add to reading log"}
                </button>
              </>
            )}
            {csv.errors.length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-red-700 mb-1">
                  {csv.errors.length} row{csv.errors.length === 1 ? "" : "s"} could not be read
                </p>
                <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                  {csv.errors.slice(0, 8).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="bg-white border border-parchment-200 rounded-xl p-5">
          <h2 className="font-serif font-semibold text-ink-900 mb-2">Recent entries</h2>
          <ul className="divide-y divide-parchment-100">
            {recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between py-1.5 text-sm">
                <span className="truncate mr-2 text-ink-700">{e.bookTitle}</span>
                <span className="flex-shrink-0 text-xs text-ink-300">
                  {e.date} · {e.pages} pg
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
