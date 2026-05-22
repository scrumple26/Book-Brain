"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Book } from "@/lib/types";
import { fetchBooks, saveBook, deleteBook as deleteBookFS } from "@/lib/firestore";
import { useAuth } from "./AuthContext";

interface BooksContextValue {
  books: Book[];
  loading: boolean;
  error: string | null;
  upsertBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
}

const BooksContext = createContext<BooksContextValue>({
  books: [],
  loading: true,
  error: null,
  upsertBook: async () => {},
  removeBook: async () => {},
});

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [fetchingBooks, setFetchingBooks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loading = authLoading || fetchingBooks;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setBooks([]);
      setFetchingBooks(false);
      return;
    }
    setFetchingBooks(true);
    setError(null);
    fetchBooks(user.uid)
      .then(setBooks)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load books: ${msg}`);
        console.error("Firestore fetch error:", err);
      })
      .finally(() => setFetchingBooks(false));
  }, [user, authLoading]);

  const upsertBook = useCallback(
    async (book: Book) => {
      if (!user) return;
      setBooks((prev) => {
        const exists = prev.some((b) => b.id === book.id);
        return exists ? prev.map((b) => (b.id === book.id ? book : b)) : [book, ...prev];
      });
      try {
        await saveBook(user.uid, book);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to save: ${msg}`);
        console.error("Firestore save error:", err);
      }
    },
    [user]
  );

  const removeBook = useCallback(
    async (bookId: string) => {
      if (!user) return;
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
      await deleteBookFS(user.uid, bookId);
    },
    [user]
  );

  return (
    <BooksContext.Provider value={{ books, loading, error, upsertBook, removeBook }}>
      {children}
    </BooksContext.Provider>
  );
}

export function useBooks() {
  return useContext(BooksContext);
}
