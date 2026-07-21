"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBooks } from "@/context/BooksContext";
import { highlight } from "@/lib/highlight";

type Result = { bookId: string; title: string; sub: string; kind: "book" | "note" };

// #10 fingertip access: a ⌘K / Ctrl+K palette to jump to any book or note from
// anywhere in the app.
export default function CommandPalette() {
  const router = useRouter();
  const { books } = useBooks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // Focus after the overlay mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results: Result[] = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const out: Result[] = [];
    for (const b of books) {
      if (b.title.toLowerCase().includes(needle) || b.author.toLowerCase().includes(needle)) {
        out.push({ bookId: b.id, title: b.title, sub: b.author, kind: "book" });
      }
    }
    for (const b of books) {
      for (const c of b.chapters) {
        if (c.deleted) continue;
        for (const n of c.notes) {
          if (n.text.toLowerCase().includes(needle)) {
            out.push({ bookId: b.id, title: n.text, sub: `${b.title} · ${c.name}`, kind: "note" });
          }
        }
      }
    }
    return out.slice(0, 30);
  }, [query, books]);

  useEffect(() => { setSel(0); }, [query]);

  if (!open) return null;

  function go(r: Result) {
    try { localStorage.setItem("bb:lastBook", r.bookId); } catch { /* ignore */ }
    setOpen(false);
    router.push(`/book/${r.bookId}`);
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm z-[60] flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter" && results[sel]) { e.preventDefault(); go(results[sel]); }
          }}
          placeholder="Jump to a book or note…"
          className="w-full px-5 py-4 text-sm text-ink-900 placeholder-ink-300 border-b border-parchment-200 focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto">
          {query.trim() === "" ? (
            <p className="px-5 py-6 text-sm text-ink-300 italic">Search your whole library — titles, authors, and every note.</p>
          ) : results.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-300 italic">No matches.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => go(r)}
                className={`w-full text-left px-5 py-2.5 flex items-start gap-3 ${i === sel ? "bg-amber-50" : "hover:bg-parchment-50"}`}
              >
                <span className="text-xs mt-0.5 flex-shrink-0">{r.kind === "book" ? "📕" : "📝"}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink-800 truncate">{highlight(r.title, query.trim())}</span>
                  <span className="block text-xs text-ink-300 truncate italic">{r.sub}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="px-5 py-2 border-t border-parchment-100 text-[11px] text-ink-300 flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">⌘K</span>
        </div>
      </div>
    </div>
  );
}
