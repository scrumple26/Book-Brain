/**
 * Prompt assembly and response parsing for AI quiz generation.
 *
 * Kept pure and separate from the route so the part most likely to need
 * tuning — what makes a *good* card versus a trivia card — is testable and
 * reviewable without a network call or an API key.
 */

export interface QuizSourceNote {
  id: string;
  chapter: string;
  text: string;
}

export interface QuizDraft {
  question: string;
  answer: string;
  sourceNoteId?: string;
}

/** Target batch size. The review UI keeps every card opt-in, so a full set is
 *  something you prune, not something that floods the queue. */
export const QUIZ_MAX_CARDS = 25;
/** Hard bound on how much of a book one request may carry, to bound cost. */
export const QUIZ_MAX_NOTES = 400;
/** Room for ~25 question/answer pairs plus the JSON envelope. */
export const QUIZ_MAX_OUTPUT_TOKENS = 4000;

/**
 * The quality instruction is the whole feature. A model handed a pile of
 * bullets will cheerfully produce "what year did X happen" — cards that are
 * easy to grade and worthless to remember. Testing the *idea* is what makes a
 * generated card worth putting into a spaced-repetition queue.
 */
export const QUIZ_SYSTEM_PROMPT = `You turn a reader's own book notes into spaced-repetition flashcards.

Write cards that test IDEAS and their APPLICATION, not incidental facts. A good card makes the reader reconstruct a concept, a distinction, or a "so what"; a bad card asks for a date, a number, a proper noun, or anything answerable by recognising a word from the note.

Rules:
- Ground every card strictly in the supplied notes. Never add facts from your own knowledge of the book, even if you recognise it.
- Use the reader's own framing and vocabulary where they had one. These are their notes, not a textbook summary.
- One idea per card. If a note holds two ideas, prefer the more useful one over cramming both in.
- Questions are answerable from memory in a sentence or two. Answers are complete but tight.
- Set sourceNoteId to the id of the note a card came from, when it comes from a single note.

Aim for ${QUIZ_MAX_CARDS} cards. Cover the notes broadly rather than clustering on one chapter. If — and only if — the notes are genuinely too thin to yield that many distinct, idea-testing cards, produce fewer rather than padding with trivia or near-duplicates; the reader would rather prune 20 strong cards than sift 25 weak ones.`;

/** Structured-output schema. Note the absence of array length constraints —
 *  the API's structured outputs don't support them, so the count is enforced
 *  in the prompt and again when parsing. */
export const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          sourceNoteId: { type: "string" },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

/**
 * Serialize notes for the prompt, grouped under chapter headings and carrying
 * ids so the model can attribute each card back to a note.
 */
export function serializeNotes(notes: QuizSourceNote[]): string {
  const lines: string[] = [];
  let currentChapter: string | null = null;
  for (const note of notes) {
    if (note.chapter !== currentChapter) {
      currentChapter = note.chapter;
      lines.push(`\n## ${currentChapter || "Notes"}`);
    }
    lines.push(`- [${note.id}] ${note.text}`);
  }
  return lines.join("\n").trim();
}

export function buildQuizUserMessage(params: {
  title: string;
  author: string;
  notes: QuizSourceNote[];
}): string {
  const { title, author, notes } = params;
  const heading = author ? `${title} — ${author}` : title;
  return `Notes from "${heading}":\n\n${serializeNotes(notes)}`;
}

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/**
 * Validate the model's output into drafts we're willing to show.
 *
 * Structured outputs make well-formed JSON very likely, not certain — and a
 * card with an empty question would be saved into a review queue and surface
 * months later as a broken prompt. Drop anything malformed rather than
 * propagating it.
 */
export function parseQuizResponse(raw: unknown): QuizDraft[] {
  const cards = (raw as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) return [];

  const drafts: QuizDraft[] = [];
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    const question = clean((card as Record<string, unknown>).question);
    const answer = clean((card as Record<string, unknown>).answer);
    if (!question || !answer) continue;
    const sourceNoteId = clean((card as Record<string, unknown>).sourceNoteId);
    drafts.push({ question, answer, ...(sourceNoteId ? { sourceNoteId } : {}) });
    if (drafts.length >= QUIZ_MAX_CARDS) break;
  }
  return drafts;
}
