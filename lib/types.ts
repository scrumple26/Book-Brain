export interface Note {
  id: string;
  text: string;
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
  createdAt: string;
  chapters: Chapter[];
}
