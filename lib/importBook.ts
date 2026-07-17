import { Book, Chapter, Note } from "./types";
import { generateId } from "./storage";

// Parsed shell of a book — caller adds id/createdAt/tags to make a full Book.
export interface ParsedBook {
  title: string;
  author: string;
  chapters: Chapter[];
}

// Undo Markdown backslash-escapes (e.g. "49\." -> "49.", "day\!" -> "day!").
function unescapeMd(s: string): string {
  return s.replace(/\\([.!?()[\]*_`~#+\-])/g, "$1");
}

function stripBold(s: string): string {
  const m = s.match(/^\*\*(.+?)\*\*$/);
  return (m ? m[1] : s).trim();
}

// A title line is either "# Title" or a bold "**Title By Author**" / "**Title**".
// Returns null when the line isn't a title.
function parseTitleLine(line: string): { title: string; author: string } | null {
  const t = line.trim();
  let inner: string | null = null;
  if (/^#\s+/.test(t)) inner = t.replace(/^#\s+/, "").trim();
  else if (/^\*\*.+\*\*$/.test(t) && !isChapterLine(t)) inner = stripBold(t);
  if (!inner) return null;
  // Split "Title By Author" on the last " by " (case-insensitive).
  const by = inner.match(/^(.*\S)\s+by\s+(\S.*)$/i);
  if (by) return { title: by[1].trim(), author: by[2].trim() };
  return { title: inner, author: "" };
}

// Chapter lines: "## 3. Name", "## Name", "**Chp 3: Name**", "**Chapter 3: Name**",
// or a bare "**3: Name**". Returns {number, name} or null.
function parseChapterLine(line: string): { number: string; name: string } | null {
  const t = line.trim();
  let body: string | null = null;
  if (/^##\s+/.test(t)) body = t.replace(/^##\s+/, "").trim();
  else if (/^\*\*.+\*\*$/.test(t)) body = stripBold(t);
  if (body === null) return null;

  // "Chp 3: Name" / "Chapter 3: Name" / "3: Name" / "3. Name"
  let m = body.match(/^(?:chp|chapter)\s*(\d+)\s*[:.]\s*(.+)$/i);
  if (m) return { number: m[1], name: m[2].trim() };
  m = body.match(/^(\d+)\s*[:.]\s*(.+)$/);
  if (m) return { number: m[1], name: m[2].trim() };
  // Chapter header with no number
  return { number: "", name: body.replace(/^(?:chp|chapter)\s+/i, "").trim() };
}

function isChapterLine(line: string): boolean {
  return parseChapterLine(line) !== null && !/\s+by\s+/i.test(stripBold(line));
}

// A note line: leading indent (2 spaces or a tab per level, clamped 0-2),
// then a bullet marker (* - +) or a numbered marker (\d+.). Returns null otherwise.
function parseNoteLine(raw: string): { indent: number; type: "bullet" | "numbered"; text: string } | null {
  const line = raw.replace(/\s+$/, ""); // drop trailing MD hard-break spaces
  if (!line.trim()) return null;
  const indentMatch = line.match(/^([ \t]*)/);
  const lead = indentMatch ? indentMatch[1].replace(/\t/g, "  ") : "";
  const indent = Math.min(Math.floor(lead.length / 2), 2);
  const body = line.trimStart();

  const bullet = body.match(/^[*\-+]\s+(.*)$/);
  if (bullet) return { indent, type: "bullet", text: unescapeMd(bullet[1].trim()) };
  // Numbered marker must be the list marker itself ("1. text"), not note text
  // that merely starts with a number ("1: text" stays a bullet's text).
  const numbered = body.match(/^\d+\.\s+(.*)$/);
  if (numbered) return { indent, type: "numbered", text: unescapeMd(numbered[1].trim()) };
  return null;
}

/**
 * Parse one or more books from Markdown. Handles the app's own export format
 * ("# Title", "*Author*", "## N. Chapter", "- note") and hand-written notes
 * ("**Title By Author**", "**Chp N: Name**", "* note" with nested indents).
 * A new title line starts a new book; multiple books in one file are supported.
 */
export function parseBooksMarkdown(text: string): ParsedBook[] {
  const lines = text.split(/\r?\n/);
  const books: ParsedBook[] = [];
  let book: ParsedBook | null = null;
  let chapter: Chapter | null = null;
  let sawTitle = false;

  const ensureChapter = () => {
    if (!book) return;
    if (!chapter) {
      chapter = { id: generateId(), name: "Notes", notes: [] };
      book.chapters.push(chapter);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // "*Author*" immediately fills the author of a title-only book
    if (book && !book.author) {
      const authorLine = line.trim().match(/^\*([^*].*?)\*$/); // *Author* (single asterisks)
      if (authorLine && sawTitle && !chapter && book.chapters.length === 0) {
        book.author = authorLine[1].trim();
        sawTitle = false;
        continue;
      }
    }

    const title = parseTitleLine(line);
    if (title && !parseNoteLine(line)) {
      book = { title: title.title, author: title.author, chapters: [] };
      books.push(book);
      chapter = null;
      sawTitle = true;
      continue;
    }
    sawTitle = false;

    const chap = !parseNoteLine(line) ? parseChapterLine(line) : null;
    if (chap && book && (line.trim().startsWith("#") || line.trim().startsWith("**"))) {
      chapter = { id: generateId(), name: chap.name, notes: [], ...(chap.number ? { number: chap.number } : {}) };
      book.chapters.push(chapter);
      continue;
    }

    const note = parseNoteLine(line);
    if (note && book) {
      ensureChapter();
      const n: Note = {
        id: generateId(),
        text: note.text,
        indent: note.indent,
        type: note.type,
        createdAt: new Date().toISOString(),
      };
      chapter!.notes.push(n);
    }
    // Non-title, non-chapter, non-note lines are ignored.
  }

  return books.filter((b) => b.chapters.some((c) => c.notes.length > 0));
}

// --- CSV import: one row per note ---------------------------------------
// Columns (header row, case-insensitive): Book, Author, Chapter, Indent, Note.
// Optional: Type ("bullet"|"numbered"), ChapterNumber.

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseBooksCsv(text: string): ParsedBook[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  if (rows.length < 2) return [];
  const header = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iBook = col("book");
  const iChapter = col("chapter");
  const iNote = col("note");
  if (iBook < 0 || iNote < 0) return []; // Book and Note columns are required
  const iAuthor = col("author");
  const iIndent = col("indent");
  const iType = col("type");
  const iChapNum = col("chapternumber");

  const byBook = new Map<string, ParsedBook>();
  const chapKey = new Map<string, Chapter>();

  for (let r = 1; r < rows.length; r++) {
    const cells = splitCsvLine(rows[r]);
    const bookTitle = (cells[iBook] ?? "").trim();
    const noteText = (cells[iNote] ?? "").trim();
    if (!bookTitle || !noteText) continue;

    let book = byBook.get(bookTitle);
    if (!book) {
      book = { title: bookTitle, author: iAuthor >= 0 ? (cells[iAuthor] ?? "").trim() : "", chapters: [] };
      byBook.set(bookTitle, book);
    }
    const chapterName = (iChapter >= 0 ? cells[iChapter] : "")?.trim() || "Notes";
    const ck = `${bookTitle}|${chapterName}`;
    let chapter = chapKey.get(ck);
    if (!chapter) {
      const num = iChapNum >= 0 ? (cells[iChapNum] ?? "").trim() : "";
      chapter = { id: generateId(), name: chapterName, notes: [], ...(num ? { number: num } : {}) };
      chapKey.set(ck, chapter);
      book.chapters.push(chapter);
    }
    const indent = iIndent >= 0 ? Math.min(Math.max(parseInt(cells[iIndent] || "0", 10) || 0, 0), 2) : 0;
    const type = iType >= 0 && (cells[iType] ?? "").toLowerCase() === "numbered" ? "numbered" : "bullet";
    chapter.notes.push({
      id: generateId(),
      text: noteText,
      indent,
      type,
      createdAt: new Date().toISOString(),
    });
  }
  return [...byBook.values()].filter((b) => b.chapters.some((c) => c.notes.length > 0));
}

/** Detect format by extension/content and parse into books. */
export function parseBooks(text: string, filename?: string): ParsedBook[] {
  const isCsv =
    (filename && /\.csv$/i.test(filename)) ||
    /^(?:"?\s*book\s*"?)\s*,/i.test(text.split(/\r?\n/)[0] ?? "");
  return isCsv ? parseBooksCsv(text) : parseBooksMarkdown(text);
}

/** Turn a ParsedBook into a full Book ready for Firestore. */
export function toBook(parsed: ParsedBook): Book {
  return {
    id: generateId(),
    title: parsed.title || "Untitled",
    author: parsed.author || "Unknown",
    tags: [],
    createdAt: new Date().toISOString(),
    chapters: parsed.chapters,
  };
}

export function countNotes(b: ParsedBook): number {
  return b.chapters.reduce((s, c) => s + c.notes.length, 0);
}
