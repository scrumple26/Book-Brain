import { describe, expect, it } from "vitest";
import type { Book, Chapter, Note } from "./types";
import {
  lensLabel,
  lensSize,
  libraryAuthors,
  libraryTags,
  normalizeAuthor,
  resolveLens,
  type Lens,
} from "./lens";

const note = (id: string, text: string, tags?: string[]): Note => ({
  id,
  text,
  indent: 0,
  tags,
  createdAt: "2026-07-01T00:00:00.000Z",
});

const chapter = (id: string, name: string, notes: Note[], deleted?: boolean): Chapter => ({
  id,
  name,
  notes,
  deleted,
});

const book = (over: Partial<Book> & Pick<Book, "id" | "title">): Book => ({
  author: "Anon",
  tags: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  chapters: [],
  ...over,
});

const library: Book[] = [
  book({
    id: "b1",
    title: "The Art Of Winning",
    author: "Bill Belichick",
    tags: ["leadership"],
    chapters: [
      chapter("c1", "Preparation", [note("n1", "Do your job"), note("n2", "No excuses")]),
      chapter("c2", "Cut chapter", [note("n3", "should never appear")], true),
    ],
  }),
  book({
    id: "b2",
    title: "Thinking Fast And Slow",
    author: "daniel  kahneman",
    tags: ["psychology"],
    chapters: [
      chapter("c3", "System 1", [
        note("n4", "Fast intuition", ["leadership"]),
        note("n5", "Slow deliberation"),
      ]),
    ],
  }),
  book({
    id: "b3",
    title: "The Beautiful Game",
    author: "Daniel Kahneman",
    tags: [],
    chapters: [chapter("c4", "Openers", [note("n6", "Press high")])],
  }),
];

const ids = (lens: Lens) => resolveLens(lens, library).map((m) => m.note.id);

describe("resolveLens", () => {
  it("scopes to one book and skips deleted chapters", () => {
    expect(ids({ type: "book", bookId: "b1" })).toEqual(["n1", "n2"]);
  });

  it("returns the whole library in stable book/chapter/note order", () => {
    expect(ids({ type: "all" })).toEqual(["n1", "n2", "n4", "n5", "n6"]);
  });

  it("matches a book-level tag against every note in that book", () => {
    // b1 is tagged "leadership" at book level -> both its notes match, plus
    // n4 which carries the tag on the note itself.
    expect(ids({ type: "tag", tag: "leadership" })).toEqual(["n1", "n2", "n4"]);
  });

  it("matches tags case-insensitively", () => {
    expect(ids({ type: "tag", tag: "LEADERSHIP" })).toEqual(ids({ type: "tag", tag: "leadership" }));
  });

  it("matches an author across books despite case and spacing drift", () => {
    // "daniel  kahneman" and "Daniel Kahneman" are the same person.
    expect(ids({ type: "author", author: "Daniel Kahneman" })).toEqual(["n4", "n5", "n6"]);
  });

  it("returns nothing for a lens that matches no book", () => {
    expect(ids({ type: "book", bookId: "nope" })).toEqual([]);
    expect(ids({ type: "author", author: "Nobody" })).toEqual([]);
    expect(ids({ type: "tag", tag: "unused" })).toEqual([]);
  });

  it("carries the owning book and chapter on every match, for citations", () => {
    const [first] = resolveLens({ type: "book", bookId: "b1" }, library);
    expect(first.book.title).toBe("The Art Of Winning");
    expect(first.chapter.name).toBe("Preparation");
  });
});

describe("lensSize", () => {
  it("counts notes and distinct books, and sizes the prompt payload", () => {
    const size = lensSize(resolveLens({ type: "tag", tag: "leadership" }, library));
    expect(size).toMatchObject({ notes: 3, books: 2 });
    expect(size.tokens).toBeGreaterThan(0);
  });

  it("is empty for an empty match set", () => {
    expect(lensSize([])).toEqual({ notes: 0, books: 0, tokens: 0 });
  });
});

describe("lensLabel", () => {
  it("names each lens for the picker", () => {
    expect(lensLabel({ type: "book", bookId: "b1" }, library)).toBe("The Art Of Winning");
    expect(lensLabel({ type: "tag", tag: "leadership" }, library)).toBe("#leadership");
    expect(lensLabel({ type: "author", author: "Bill Belichick" }, library)).toBe("Bill Belichick");
    expect(lensLabel({ type: "all" }, library)).toBe("Entire library");
  });

  it("degrades rather than throwing on a deleted book", () => {
    expect(lensLabel({ type: "book", bookId: "gone" }, library)).toBe("Unknown book");
  });
});

describe("picker sources", () => {
  it("dedupes authors by normalized form, keeping the first spelling seen", () => {
    expect(libraryAuthors(library)).toEqual(["Bill Belichick", "daniel kahneman"]);
  });

  it("collects tags from both books and notes", () => {
    expect(libraryTags(library)).toEqual(["leadership", "psychology"]);
  });
});

describe("normalizeAuthor", () => {
  it("collapses case and internal whitespace", () => {
    expect(normalizeAuthor("  Bill   BELICHICK ")).toBe("bill belichick");
  });
});
