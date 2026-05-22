import { Book } from "./types";

const KEY = "book-brain-data";

export function loadBooks(): Book[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBooks(books: Book[]): void {
  localStorage.setItem(KEY, JSON.stringify(books));
}

export function generateId(): string {
  return crypto.randomUUID();
}
