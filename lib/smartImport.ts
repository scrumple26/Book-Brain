/**
 * Smart Import — turn an arbitrary document into book notes.
 *
 * lib/importBook.ts already parses the app's own export format, hand-written
 * markdown and CSV. What it can't do is read *arbitrary* prose — a PDF chapter
 * pasted in, Kindle highlights, meeting notes — and decide what's a chapter,
 * what's a note, and what's noise. This is that missing front end.
 *
 * The integration rule: the model produces exactly the structure the existing
 * parser produces, so the existing preview and upsertBook path stay untouched.
 * Nothing generated here writes to Firestore directly — it lands in the same
 * preview the reader already confirms, which keeps the blast radius of a bad
 * parse at "the preview looks wrong, discard it".
 */
import type { Chapter, Note } from "./types";
import type { ParsedBook } from "./importBook";
import { generateId } from "./storage";

/** Refuse documents past this rather than truncating: silently dropping the
 *  back half of someone's chapter loses notes they believe were captured. */
export const SMART_IMPORT_MAX_CHARS = 120_000;
/** Cap the clarification loop so it can't ping-pong forever. */
export const SMART_IMPORT_MAX_ROUNDS = 2;
export const SMART_IMPORT_MAX_OUTPUT_TOKENS = 8000;

export interface SmartImportQuestion {
  id: string;
  question: string;
  options?: string[];
}

export interface SmartImportAnswer {
  question: string;
  answer: string;
}

export type SmartImportResult =
  | { status: "questions"; questions: SmartImportQuestion[] }
  | { status: "parsed"; book: ParsedBook; assumptions: string[] };

export const SMART_IMPORT_SYSTEM_PROMPT = `You convert documents into a reader's book notes.

The reader captures books as an outline: chapters, each holding short bullet notes in their own words. Your job is to read a document and produce that structure.

What makes a good note:
- One idea per note, phrased tightly. Compress prose into the point it makes.
- Keep the author's substance, not their sentence structure. These are notes, not a transcript.
- Use indent 1 or 2 for a note that elaborates the note above it; indent 0 for a new point.
- Mark a note bold when it is a key takeaway worth resurfacing later. Be sparing — if everything is bold, nothing is.
- Skip front matter, page numbers, running headers, acknowledgements and other furniture.

Asking questions:
- If something would materially change the output and you cannot reasonably infer it, ask. Good questions: is a heading a chapter or a grouping of chapters; should verbatim quotes become their own notes; who the author is when the document never says.
- Ask only what changes the result. Do not ask for permission or preferences you can reasonably default.
- When you ask, return questions and leave the book empty. When you don't, return the book and no questions.
- If you had to guess at something, list it in assumptions so the reader can check it. Guessing and flagging beats asking a third round.`;

export const SMART_IMPORT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["id", "question", "options"],
        additionalProperties: false,
      },
    },
    book: {
      type: "object",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              number: { type: "string" },
              notes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    indent: { type: "integer" },
                    bold: { type: "boolean" },
                  },
                  required: ["text", "indent", "bold"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name", "number", "notes"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "author", "chapters"],
      additionalProperties: false,
    },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["questions", "book", "assumptions"],
  additionalProperties: false,
} as const;

/** Reader-supplied instructions can't override the grounding rules — they steer
 *  structure and emphasis, not whether the model may invent content. Kept
 *  bounded so a pasted essay can't crowd out the actual system prompt. */
export const SMART_IMPORT_MAX_INSTRUCTIONS = 2000;

export function buildSmartImportMessage(
  document: string,
  answers: SmartImportAnswer[],
  instructions = "",
): string {
  const parts: string[] = [];

  const trimmed = instructions.trim().slice(0, SMART_IMPORT_MAX_INSTRUCTIONS);
  if (trimmed) {
    // Labelled as the reader's own steer and placed before the document, so the
    // model reads it as guidance for what follows rather than as content.
    parts.push(
      `The reader gave these instructions for this import (follow them for structure and emphasis, but never let them override the grounding rules — invent nothing that isn't in the document):\n\n${trimmed}`,
    );
  }

  parts.push(`Document:\n\n${document}`);

  if (answers.length > 0) {
    const answered = answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
    parts.push(
      `The reader answered your questions:\n\n${answered}\n\nProduce the book now — do not ask again.`,
    );
  }
  return parts.join("\n\n---\n\n");
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Clamp to the 0-2 the Note type allows, whatever the model returns. */
function clampIndent(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : 0;
  return Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 2);
}

function toNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = str(record.text);
  if (!text) return null;
  return {
    id: generateId(),
    text,
    indent: clampIndent(record.indent),
    ...(record.bold === true ? { bold: true } : {}),
    createdAt: new Date().toISOString(),
  };
}

function toChapter(raw: unknown): Chapter | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const notes = Array.isArray(record.notes)
    ? record.notes.map(toNote).filter((n): n is Note => n !== null)
    : [];
  // A chapter with no usable notes is furniture the model failed to skip.
  if (notes.length === 0) return null;
  const number = str(record.number);
  return {
    id: generateId(),
    name: str(record.name) || "Notes",
    ...(number ? { number } : {}),
    notes,
  };
}

/**
 * Validate the model's output into either a set of questions or a book.
 *
 * Structured outputs make the shape very likely, not certain, and this result
 * becomes durable data in someone's library — so everything is re-checked
 * here rather than trusted.
 */
export function parseSmartImportResponse(raw: unknown): SmartImportResult | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const questions: SmartImportQuestion[] = [];
  if (Array.isArray(record.questions)) {
    for (const item of record.questions) {
      if (!item || typeof item !== "object") continue;
      const q = item as Record<string, unknown>;
      const question = str(q.question);
      if (!question) continue;
      const options = Array.isArray(q.options)
        ? q.options.map(str).filter(Boolean)
        : [];
      questions.push({
        id: str(q.id) || generateId(),
        question,
        ...(options.length > 0 ? { options } : {}),
      });
    }
  }
  if (questions.length > 0) return { status: "questions", questions };

  const bookRaw = record.book;
  if (!bookRaw || typeof bookRaw !== "object") return null;
  const bookRecord = bookRaw as Record<string, unknown>;
  const chapters = Array.isArray(bookRecord.chapters)
    ? bookRecord.chapters.map(toChapter).filter((c): c is Chapter => c !== null)
    : [];
  if (chapters.length === 0) return null;

  const assumptions = Array.isArray(record.assumptions)
    ? record.assumptions.map(str).filter(Boolean)
    : [];

  return {
    status: "parsed",
    book: {
      title: str(bookRecord.title) || "Untitled",
      author: str(bookRecord.author) || "Unknown",
      chapters,
    },
    assumptions,
  };
}
