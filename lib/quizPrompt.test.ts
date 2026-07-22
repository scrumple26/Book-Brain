import { describe, expect, it } from "vitest";
import {
  QUIZ_MAX_CARDS,
  buildQuizUserMessage,
  parseQuizResponse,
  serializeNotes,
  type QuizSourceNote,
} from "./quizPrompt";

const notes: QuizSourceNote[] = [
  { id: "n1", chapter: "Preparation", text: "Do your job" },
  { id: "n2", chapter: "Preparation", text: "No excuses" },
  { id: "n3", chapter: "Execution", text: "Situational awareness wins games" },
];

describe("serializeNotes", () => {
  it("groups notes under chapter headings and tags each with its id", () => {
    const out = serializeNotes(notes);
    expect(out).toBe(
      "## Preparation\n- [n1] Do your job\n- [n2] No excuses\n\n## Execution\n- [n3] Situational awareness wins games",
    );
  });

  it("only opens a heading when the chapter actually changes", () => {
    expect(serializeNotes(notes).match(/## Preparation/g)).toHaveLength(1);
  });

  it("falls back to a generic heading for unnamed chapters", () => {
    expect(serializeNotes([{ id: "n1", chapter: "", text: "x" }])).toContain("## Notes");
  });

  it("handles an empty note set without producing stray headings", () => {
    expect(serializeNotes([])).toBe("");
  });
});

describe("buildQuizUserMessage", () => {
  it("names the book and author so the model knows the source", () => {
    const msg = buildQuizUserMessage({ title: "The Art Of Winning", author: "Bill Belichick", notes });
    expect(msg).toContain('"The Art Of Winning — Bill Belichick"');
    expect(msg).toContain("- [n1] Do your job");
  });

  it("omits the dash when there is no author", () => {
    const msg = buildQuizUserMessage({ title: "Untitled", author: "", notes: [] });
    expect(msg).toContain('"Untitled"');
    expect(msg).not.toContain("—");
  });
});

describe("parseQuizResponse", () => {
  it("keeps well-formed cards and normalizes their whitespace", () => {
    const drafts = parseQuizResponse({
      cards: [{ question: "  What is   the point? ", answer: "Do your\njob.", sourceNoteId: "n1" }],
    });
    expect(drafts).toEqual([{ question: "What is the point?", answer: "Do your job.", sourceNoteId: "n1" }]);
  });

  it("drops cards missing a question or an answer", () => {
    // A card with an empty side would be saved and resurface months later as a
    // broken review prompt — better to lose it here.
    const drafts = parseQuizResponse({
      cards: [
        { question: "Good?", answer: "Yes" },
        { question: "", answer: "orphan answer" },
        { question: "orphan question", answer: "   " },
        { question: "Also good?", answer: "Yes" },
      ],
    });
    expect(drafts.map((d) => d.question)).toEqual(["Good?", "Also good?"]);
  });

  it("omits sourceNoteId rather than storing an empty one", () => {
    const [draft] = parseQuizResponse({ cards: [{ question: "q", answer: "a", sourceNoteId: "" }] });
    expect(draft).not.toHaveProperty("sourceNoteId");
  });

  it("caps the batch so one click cannot flood the review queue", () => {
    const cards = Array.from({ length: 40 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    expect(parseQuizResponse({ cards })).toHaveLength(QUIZ_MAX_CARDS);
  });

  it("returns nothing for malformed or unexpected shapes", () => {
    expect(parseQuizResponse(null)).toEqual([]);
    expect(parseQuizResponse({})).toEqual([]);
    expect(parseQuizResponse({ cards: "not an array" })).toEqual([]);
    expect(parseQuizResponse({ cards: [null, 42, "nope"] })).toEqual([]);
  });
});
