/**
 * Prompt assembly and answer parsing for lens-scoped questions.
 *
 * Two jobs, both isolated from the route so they're testable without a key:
 * building a stable, cacheable notes block, and pulling citations back out of
 * the answer so every claim can be traced to a note the reader actually wrote.
 */

export interface AskSourceNote {
  id: string;
  book: string;
  chapter: string;
  text: string;
}

export interface AskCitation {
  id: string;
  book: string;
  chapter: string;
  text: string;
}

export interface ParsedAnswer {
  /** Answer prose with the raw [id] markers stripped out. */
  answer: string;
  /** Notes the answer actually leaned on, in first-mention order. */
  citations: AskCitation[];
}

/** Bounds on a single question, so one click can't spend a large share of the
 *  shared monthly pool. Both are checked server-side. */
export const ASK_MAX_NOTES = 5000;
export const ASK_MAX_INPUT_TOKENS = 400_000;
export const ASK_MAX_OUTPUT_TOKENS = 1500;

export const ASK_SYSTEM_PROMPT = `You answer questions using only a reader's own book notes.

These notes are the reader's own words — condensed, sometimes cryptic, written for themselves. Treat them as the sole source of truth.

Rules:
- Answer ONLY from the supplied notes. Never add facts from your own knowledge of these books, even when you recognise them.
- If the notes don't address the question, say so plainly and stop. A short honest "your notes don't cover this" is far more useful than a plausible answer the reader will assume came from their reading.
- Cite the notes you used by appending their id in square brackets, like [n1], immediately after the claim it supports. Cite only ids that appear in the notes.
- Synthesise across books when the notes support it — connections the reader hasn't spelled out are the most valuable thing you can surface, as long as each half is grounded in a real note.
- Be concise and concrete. Use the reader's own vocabulary rather than restating their ideas in generic language.`;

/**
 * Serialize notes into the cacheable prompt block.
 *
 * Grouped by book then chapter, in the order the lens resolved them. That
 * order is load-bearing: this block is a cached prefix, and prompt caching
 * matches on bytes, so a block that reshuffled between two questions about the
 * same lens would silently miss the cache and pay full price every time.
 */
export function serializeAskNotes(notes: AskSourceNote[]): string {
  const lines: string[] = [];
  let book: string | null = null;
  let chapter: string | null = null;
  for (const note of notes) {
    if (note.book !== book) {
      book = note.book;
      chapter = null;
      lines.push(`\n# ${book}`);
    }
    if (note.chapter !== chapter) {
      chapter = note.chapter;
      lines.push(`\n## ${chapter || "Notes"}`);
    }
    lines.push(`- [${note.id}] ${note.text}`);
  }
  return lines.join("\n").trim();
}

const CITATION_PATTERN = /\[([A-Za-z0-9_-]+)\]/g;

/**
 * Split an answer into prose and the notes it cited.
 *
 * Unknown ids are dropped rather than surfaced: a citation the reader can't
 * click through to is worse than no citation, because it looks like evidence.
 */
export function parseAnswer(raw: string, notes: AskSourceNote[]): ParsedAnswer {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const citations: AskCitation[] = [];
  const seen = new Set<string>();

  for (const match of raw.matchAll(CITATION_PATTERN)) {
    const id = match[1];
    if (seen.has(id)) continue;
    const note = byId.get(id);
    if (!note) continue;
    seen.add(id);
    citations.push({ id: note.id, book: note.book, chapter: note.chapter, text: note.text });
  }

  const answer = raw
    .replace(CITATION_PATTERN, "")
    // Markers sit mid-sentence, so removing them leaves doubled spaces and
    // orphaned spaces before punctuation.
    .replace(/ {2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return { answer, citations };
}
