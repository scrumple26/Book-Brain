"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Book } from "@/lib/types";
import { fetchBooks, saveBook, deleteBook as deleteBookFS } from "@/lib/firestore";
import { useAuth } from "./AuthContext";

interface BooksContextValue {
  books: Book[];
  loading: boolean;
  upsertBook: (book: Book) => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
}

const BooksContext = createContext<BooksContextValue>({
  books: [],
  loading: true,
  upsertBook: async () => {},
  removeBook: async () => {},
});

export function BooksProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [fetchingBooks, setFetchingBooks] = useState(false);

  // True while auth is resolving OR while books are being fetched from Firestore
  const loading = authLoading || fetchingBooks;

  useEffect(() => {
    if (authLoading) return; // wait for auth to settle first
    if (!user) { setBooks([]); return; }
    setFetchingBooks(true);
    fetchBooks(user.uid)
      .then(setBooks)
      .finally(() => setFetchingBooks(false));
  }, [user, authLoading]);

  const upsertBook = useCallback(
    async (book: Book) => {
      if (!user) return;
      setBooks((prev) => {
        const exists = prev.some((b) => b.id === book.id);
        return exists ? prev.map((b) => (b.id === book.id ? book : b)) : [book, ...prev];
      });
      await saveBook(user.uid, book);
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
    <BooksContext.Provider value={{ books, loading, upsertBook, removeBook }}>
      {children}
    </BooksContext.Provider>
  );
}

export function useBooks() {
  return useContext(BooksContext);
}
