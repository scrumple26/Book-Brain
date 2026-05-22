export interface Note {
  id: string;
  text: string;
  indent: number;   // 0 | 1 | 2
  type?: "bullet" | "numbered";
  createdAt: string;
}

export interface Chapter {
  id: string;
  name: string;
  notes: Note[];
}

export interface Book {
  id: string;
  title: string;
  author: string;
  tags: string[];
  createdAt: string;
  chapters: Chapter[];
}
