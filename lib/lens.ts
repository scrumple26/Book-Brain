/**
 * Lenses — the scope primitive for every Book Brain question.
 *
 * A lens decides which notes a question is allowed to see. It is a discriminated
 * union on purpose: adding a shelf lens, a year-read lens or a multi-book
 * selection later is a new variant plus a new branch in resolveLens(), not a
 * change to any route or component. Everything downstream (prompt assembly,
 * citations, token estimates) consumes the single LensMatch[] this returns.
 */
import type { Book, Chapter, Note } from "./types";
import { approxTokens } from "./ai";

export type Lens =
  | { type: "book"; bookId: string }
  | { type: "tag"; tag: string }
  | { type: "author"; author: string }
  | { type: "all" };

export interface LensMatch {
  book: Book;
  chapter: Chapter;
  note: Note;
}

/** Author strings are hand-typed on the add-book form, so they drift in case
 *  and spacing ("Bill Belichick" / "bill  belichick"). Compare normalized. */
export function normalizeAuthor(author: string): string {
  return author.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Tags are matched case-insensitively for the same reason. */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function bookMatchesTag(book: Book, tag: string): boolean {
  return book.tags.some((t) => normalizeTag(t) === tag);
}

function noteMatchesTag(note: Note, tag: string): boolean {
  return (note.tags ?? []).some((t) => normalizeTag(t) === tag);
}

/**
 * Every note the lens can see, in stable book → chapter → note order.
 *
 * Order matters beyond tidiness: the serialized notes become a cached prompt
 * prefix, and prompt caching is a byte-prefix match — a set that reorders
 * between two questions about the same lens would silently miss the cache.
 * Deleted chapters are always excluded.
 */
export function resolveLens(lens: Lens, books: Book[]): LensMatch[] {
  const matches: LensMatch[] = [];
  const tag = lens.type === "tag" ? normalizeTag(lens.tag) : "";
  const author = lens.type === "author" ? normalizeAuthor(lens.author) : "";

  for (const book of books) {
    if (lens.type === "book" && book.id !== lens.bookId) continue;
    if (lens.type === "author" && normalizeAuthor(book.author) !== author) continue;

    // A tag on the book applies to all of its notes; otherwise the note must
    // carry the tag itself. This mirrors how the library tag filter and the
    // related-notes panel already treat book-level vs note-level tags.
    const bookTagged = lens.type === "tag" && bookMatchesTag(book, tag);

    for (const chapter of book.chapters) {
      if (chapter.deleted) continue;
      for (const note of chapter.notes) {
        if (lens.type === "tag" && !bookTagged && !noteMatchesTag(note, tag)) continue;
        matches.push({ book, chapter, note });
      }
    }
  }
  return matches;
}

/** Human label for the lens picker and for citing what an answer read. */
export function lensLabel(lens: Lens, books: Book[]): string {
  switch (lens.type) {
    case "book":
      return books.find((b) => b.id === lens.bookId)?.title ?? "Unknown book";
    case "tag":
      return `#${lens.tag}`;
    case "author":
      return lens.author || "Unknown author";
    case "all":
      return "Entire library";
  }
}

export interface LensSize {
  notes: number;
  books: number;
  /** Approximate prompt tokens the matched notes will occupy. */
  tokens: number;
}

/**
 * Size a lens before spending anything on it. The hub shows this next to the
 * picker so a whole-library question — an order of magnitude pricier than a
 * typical tag — is a visible choice rather than a surprise on the usage bar.
 */
export function lensSize(matches: LensMatch[]): LensSize {
  const books = new Set<string>();
  let tokens = 0;
  for (const m of matches) {
    books.add(m.book.id);
    // +8 tokens/note covers the book/chapter attribution wrapper each note
    // carries into the prompt so answers can cite their sources.
    tokens += approxTokens(m.note.text) + 8;
  }
  return { notes: matches.length, books: books.size, tokens };
}

/** Tidy a hand-entered value for display: collapse whitespace, keep the
 *  author's own capitalization rather than title-casing their name for them. */
function displayForm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Distinct authors across the library, for the author lens picker. */
export function libraryAuthors(books: Book[]): string[] {
  const seen = new Map<string, string>();
  for (const book of books) {
    const key = normalizeAuthor(book.author);
    if (key && !seen.has(key)) seen.set(key, displayForm(book.author));
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Distinct tags across books and notes, for the tag lens picker. */
export function libraryTags(books: Book[]): string[] {
  const seen = new Map<string, string>();
  const add = (tag: string) => {
    const key = normalizeTag(tag);
    if (key && !seen.has(key)) seen.set(key, displayForm(tag));
  };
  for (const book of books) {
    book.tags.forEach(add);
    for (const chapter of book.chapters) {
      if (chapter.deleted) continue;
      for (const note of chapter.notes) (note.tags ?? []).forEach(add);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
