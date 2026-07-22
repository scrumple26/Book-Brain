export interface Note {
  id: string;
  text: string;
  indent: number;   // 0 | 1 | 2
  type?: "bullet" | "numbered";
  bold?: boolean;
  tags?: string[];  // note-level tags for cross-book clustering
  createdAt: string;
}

export interface Chapter {
  id: string;
  name: string;
  number?: string;
  notes: Note[];
  deleted?: boolean;
}

export interface ReadingEntry {
  date: string;   // YYYY-MM-DD
  pages: number;
}

export interface QuizCard {
  id: string;
  question: string;
  answer: string;
  sourceNoteId?: string; // if promoted from a note
  aiGenerated?: boolean;  // drafted by Book Brain and kept during review
  // SM-2-lite spaced-repetition scheduling (all optional — older cards are "due").
  dueDate?: string;       // YYYY-MM-DD; absent = due now
  intervalDays?: number;  // current spacing interval
  easeFactor?: number;    // difficulty multiplier, min 1.3
  lastReviewedAt?: string; // ISO timestamp
}

export type BookStatus = "wishlist" | "reading" | "completed";

export interface Book {
  id: string;
  title: string;
  author: string;
  tags: string[];
  status?: BookStatus; // absent on older books — derive with bookStatus()
  takeaway?: string;   // distilled one-line summary (progressive summarization)
  dateCompleted?: string; // ISO date string YYYY-MM-DD
  createdAt: string;
  chapters: Chapter[];
  readingLog?: ReadingEntry[];
  quizCards?: QuizCard[];
}

// Resolve a book's shelf. Wishlist is explicit-only. A completion date always
// means completed (so setting a date on the book page shelves it correctly,
// even on older books with no status field). Otherwise honor an explicit
// status, defaulting to currently reading.
export function bookStatus(book: Book): BookStatus {
  if (book.status === "wishlist") return "wishlist";
  if (book.dateCompleted) return "completed";
  return book.status ?? "reading";
}
