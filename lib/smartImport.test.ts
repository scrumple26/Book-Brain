import { describe, expect, it } from "vitest";
import { SMART_IMPORT_MAX_INSTRUCTIONS, buildSmartImportMessage, parseSmartImportResponse } from "./smartImport";

const bookPayload = {
  questions: [],
  assumptions: [],
  book: {
    title: "The Art Of Winning",
    author: "Bill Belichick",
    chapters: [
      {
        name: "Preparation",
        number: "1",
        notes: [
          { text: "Do your job", indent: 0, bold: true },
          { text: "Know the situation", indent: 1, bold: false },
        ],
      },
    ],
  },
};

describe("parseSmartImportResponse", () => {
  it("builds a book matching the shape the existing importer produces", () => {
    const result = parseSmartImportResponse(bookPayload);
    expect(result?.status).toBe("parsed");
    if (result?.status !== "parsed") return;

    expect(result.book.title).toBe("The Art Of Winning");
    expect(result.book.author).toBe("Bill Belichick");
    expect(result.book.chapters).toHaveLength(1);

    const [chapter] = result.book.chapters;
    expect(chapter.name).toBe("Preparation");
    expect(chapter.number).toBe("1");
    expect(chapter.id).toBeTruthy();
    expect(chapter.notes[0]).toMatchObject({ text: "Do your job", indent: 0, bold: true });
    expect(chapter.notes[0].id).toBeTruthy();
    expect(chapter.notes[0].createdAt).toBeTruthy();
  });

  it("gives every chapter and note a distinct id", () => {
    const result = parseSmartImportResponse(bookPayload);
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    const ids = result.book.chapters.flatMap((c) => [c.id, ...c.notes.map((n) => n.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("omits bold rather than storing false, matching the Note type's optional field", () => {
    const result = parseSmartImportResponse(bookPayload);
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    expect(result.book.chapters[0].notes[1]).not.toHaveProperty("bold");
  });

  it("clamps indent into the 0-2 the outline supports", () => {
    const result = parseSmartImportResponse({
      ...bookPayload,
      book: {
        ...bookPayload.book,
        chapters: [
          {
            name: "C",
            number: "",
            notes: [
              { text: "too deep", indent: 9, bold: false },
              { text: "negative", indent: -4, bold: false },
              { text: "nonsense", indent: "x", bold: false },
            ],
          },
        ],
      },
    });
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    expect(result.book.chapters[0].notes.map((n) => n.indent)).toEqual([2, 0, 0]);
  });

  it("returns questions when the model needs clarification, ignoring any book", () => {
    const result = parseSmartImportResponse({
      questions: [
        { id: "q1", question: "Is 'Part One' a chapter or a grouping?", options: ["Chapter", "Grouping"] },
      ],
      assumptions: [],
      book: bookPayload.book,
    });
    expect(result).toEqual({
      status: "questions",
      questions: [
        { id: "q1", question: "Is 'Part One' a chapter or a grouping?", options: ["Chapter", "Grouping"] },
      ],
    });
  });

  it("keeps a question that has no options", () => {
    const result = parseSmartImportResponse({
      questions: [{ id: "q1", question: "Who wrote this?", options: [] }],
      assumptions: [],
      book: bookPayload.book,
    });
    if (result?.status !== "questions") throw new Error("expected questions");
    expect(result.questions[0]).not.toHaveProperty("options");
  });

  it("surfaces assumptions so a guess can be checked", () => {
    const result = parseSmartImportResponse({
      ...bookPayload,
      assumptions: ["Treated 'Part One' as a chapter.", "  "],
    });
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    expect(result.assumptions).toEqual(["Treated 'Part One' as a chapter."]);
  });

  it("drops chapters whose notes are all unusable", () => {
    // An empty chapter is furniture the model failed to skip; importing it
    // would put a blank section into the reader's library.
    const result = parseSmartImportResponse({
      ...bookPayload,
      book: {
        ...bookPayload.book,
        chapters: [
          { name: "Acknowledgements", number: "", notes: [{ text: "   ", indent: 0, bold: false }] },
          bookPayload.book.chapters[0],
        ],
      },
    });
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    expect(result.book.chapters.map((c) => c.name)).toEqual(["Preparation"]);
  });

  it("rejects a response with no questions and no usable chapters", () => {
    expect(parseSmartImportResponse({ questions: [], assumptions: [], book: { chapters: [] } })).toBeNull();
    expect(parseSmartImportResponse(null)).toBeNull();
    expect(parseSmartImportResponse({})).toBeNull();
  });

  it("falls back to placeholders rather than saving an untitled empty book", () => {
    const result = parseSmartImportResponse({
      questions: [],
      assumptions: [],
      book: { title: "", author: "", chapters: bookPayload.book.chapters },
    });
    if (result?.status !== "parsed") throw new Error("expected a parsed book");
    expect(result.book.title).toBe("Untitled");
    expect(result.book.author).toBe("Unknown");
  });
});

describe("buildSmartImportMessage", () => {
  it("sends just the document on the first round", () => {
    const msg = buildSmartImportMessage("Chapter 1\nSome prose.", []);
    expect(msg).toContain("Document:");
    expect(msg).toContain("Some prose.");
    expect(msg).not.toContain("answered your questions");
  });

  it("replays answers and forbids another round of questions", () => {
    const msg = buildSmartImportMessage("doc", [
      { question: "Chapter or grouping?", answer: "Grouping" },
    ]);
    expect(msg).toContain("Q: Chapter or grouping?");
    expect(msg).toContain("A: Grouping");
    expect(msg).toContain("do not ask again");
  });
});

describe("buildSmartImportMessage instructions", () => {
  it("places reader instructions before the document, guarding the grounding rule", () => {
    const msg = buildSmartImportMessage("Some prose.", [], "Treat Parts as chapters.");
    expect(msg.indexOf("Treat Parts as chapters.")).toBeLessThan(msg.indexOf("Some prose."));
    expect(msg).toContain("never let them override the grounding rules");
  });

  it("omits the instructions block entirely when none are given", () => {
    const msg = buildSmartImportMessage("doc", []);
    expect(msg).not.toContain("gave these instructions");
  });

  it("caps runaway instructions so they can't crowd out the system prompt", () => {
    const huge = "x".repeat(5000);
    const msg = buildSmartImportMessage("doc", [], huge);
    expect((msg.match(/x/g) ?? []).length).toBe(SMART_IMPORT_MAX_INSTRUCTIONS);
  });
});
