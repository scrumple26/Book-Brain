export interface Note {
  id: string;
  text: string;
  indent: number;   // 0 | 1 | 2
  type?: "bullet" | "numbered";
  bold?: boolean;
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

export interface Book {
  id: string;
  title: string;
  author: string;
  tags: string[];
  dateCompleted?: string; // ISO date string YYYY-MM-DD
  createdAt: string;
  chapters: Chapter[];
  readingLog?: ReadingEntry[];
}
