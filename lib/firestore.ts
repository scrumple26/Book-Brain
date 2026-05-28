import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { Book } from "./types";

function booksRef(uid: string) {
  return collection(getFirebaseDb(), "users", uid, "books");
}

export async function fetchBooks(uid: string): Promise<Book[]> {
  const q = query(booksRef(uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Book);
}

export async function saveBook(uid: string, book: Book): Promise<void> {
  await setDoc(doc(booksRef(uid), book.id), book);
}

export async function deleteBook(uid: string, bookId: string): Promise<void> {
  await deleteDoc(doc(booksRef(uid), bookId));
}

function backupsRef(uid: string) {
  return collection(getFirebaseDb(), "users", uid, "backups");
}

export async function hasTodayBackup(uid: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const snap = await getDoc(doc(backupsRef(uid), today));
  return snap.exists();
}

export async function saveBackup(uid: string, books: Book[]): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await setDoc(doc(backupsRef(uid), today), { id: today, books, createdAt: new Date().toISOString() });
}
