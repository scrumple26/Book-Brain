import { describe, expect, it } from "vitest";
import { parseAnswer, serializeAskNotes, type AskSourceNote } from "./askPrompt";

const notes: AskSourceNote[] = [
  { id: "n1", book: "The Art Of Winning", chapter: "Preparation", text: "Do your job" },
  { id: "n2", book: "The Art Of Winning", chapter: "Preparation", text: "No excuses" },
  { id: "n3", book: "The Art Of Winning", chapter: "Execution", text: "Situational awareness" },
  { id: "n4", book: "Thinking Fast And Slow", chapter: "System 1", text: "Fast intuition" },
];

describe("serializeAskNotes", () => {
  it("groups by book then chapter, tagging every note with its id", () => {
    expect(serializeAskNotes(notes)).toBe(
      [
        "# The Art Of Winning",
        "",
        "## Preparation",
        "- [n1] Do your job",
        "- [n2] No excuses",
        "",
        "## Execution",
        "- [n3] Situational awareness",
        "",
        "# Thinking Fast And Slow",
        "",
        "## System 1",
        "- [n4] Fast intuition",
      ].join("\n"),
    );
  });

  it("emits each heading exactly once per run", () => {
    const out = serializeAskNotes(notes);
    expect(out.match(/## Preparation/g)).toHaveLength(1);
    expect(out.match(/# The Art Of Winning/g)).toHaveLength(1);
  });

  it("is byte-stable for the same input, so the cached prefix keeps hitting", () => {
    expect(serializeAskNotes(notes)).toBe(serializeAskNotes([...notes]));
  });

  it("handles an empty set", () => {
    expect(serializeAskNotes([])).toBe("");
  });
});

describe("parseAnswer", () => {
  it("strips citation markers and returns the notes behind them", () => {
    const { answer, citations } = parseAnswer(
      "Preparation is the whole thing [n1]. Excuses are noise [n2].",
      notes,
    );
    expect(answer).toBe("Preparation is the whole thing. Excuses are noise.");
    expect(citations.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(citations[0]).toMatchObject({ book: "The Art Of Winning", chapter: "Preparation" });
  });

  it("lists each cited note once, in first-mention order", () => {
    const { citations } = parseAnswer("A [n3]. B [n1]. C [n3] again.", notes);
    expect(citations.map((c) => c.id)).toEqual(["n3", "n1"]);
  });

  it("drops ids that aren't real notes", () => {
    // A citation the reader can't click through to is worse than none — it
    // looks like evidence.
    const { answer, citations } = parseAnswer("Confident claim [n99].", notes);
    expect(citations).toEqual([]);
    expect(answer).toBe("Confident claim.");
  });

  it("does not leave doubled spaces or spaces before punctuation", () => {
    const { answer } = parseAnswer("One [n1] two [n2] , three [n4] .", notes);
    expect(answer).toBe("One two, three.");
  });

  it("preserves paragraph structure", () => {
    const { answer } = parseAnswer("First point [n1].\n\nSecond point [n4].", notes);
    expect(answer).toBe("First point.\n\nSecond point.");
  });

  it("handles an ungrounded answer with no citations at all", () => {
    const { answer, citations } = parseAnswer("Your notes don't cover this.", notes);
    expect(answer).toBe("Your notes don't cover this.");
    expect(citations).toEqual([]);
  });
});
