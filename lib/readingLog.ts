/**
 * Reading-log CSV import.
 *
 * Format mirrors the note importer's CSV: a header row plus `Book`, `Date`,
 * `Pages`. Books are matched by title against the library, because a title is
 * what someone actually has in a spreadsheet — nobody exports Firestore ids.
 *
 * Rows that don't match are reported, never dropped silently: a reading log
 * that quietly loses half its rows is worse than one that refuses them, since
 * you'd have no reason to look.
 */
import type { Book, ReadingEntry } from "./types";

export interface ParsedLogRow {
  bookId: string;
  bookTitle: string;
  entry: ReadingEntry;
}

export interface ParsedLogResult {
  rows: ParsedLogRow[];
  errors: string[];
}

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/** Accepts YYYY-MM-DD, or M/D/YYYY as spreadsheets tend to emit. */
export function normalizeLogDate(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export function parseReadingLogCsv(text: string, books: Book[]): ParsedLogResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedLogRow[] = [];
  const errors: string[] = [];
  if (lines.length === 0) return { rows, errors: ["The file is empty."] };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const bookCol = header.indexOf("book");
  const dateCol = header.indexOf("date");
  const pagesCol = header.indexOf("pages");
  if (bookCol === -1 || dateCol === -1 || pagesCol === -1) {
    return { rows, errors: ["The header row needs Book, Date and Pages columns."] };
  }

  const byTitle = new Map(books.map((b) => [normalizeTitle(b.title), b]));

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const title = cells[bookCol] ?? "";
    const book = byTitle.get(normalizeTitle(title));
    if (!book) {
      errors.push(`Row ${i + 1}: no book titled "${title}" in your library.`);
      continue;
    }
    const date = normalizeLogDate(cells[dateCol] ?? "");
    if (!date) {
      errors.push(`Row ${i + 1}: "${cells[dateCol] ?? ""}" isn't a date (use YYYY-MM-DD).`);
      continue;
    }
    const pages = Number(cells[pagesCol]);
    if (!Number.isFinite(pages) || pages <= 0) {
      errors.push(`Row ${i + 1}: "${cells[pagesCol] ?? ""}" isn't a page count.`);
      continue;
    }
    rows.push({
      bookId: book.id,
      bookTitle: book.title,
      entry: { date, pages: Math.round(pages) },
    });
  }

  return { rows, errors };
}

/** Group parsed rows by book, so each book is saved once rather than per row. */
export function groupLogRowsByBook(rows: ParsedLogRow[]): Map<string, ReadingEntry[]> {
  const grouped = new Map<string, ReadingEntry[]>();
  for (const row of rows) {
    const list = grouped.get(row.bookId) ?? [];
    list.push(row.entry);
    grouped.set(row.bookId, list);
  }
  return grouped;
}
