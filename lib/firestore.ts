import {
  collection,
  doc,
  getDocs,
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
