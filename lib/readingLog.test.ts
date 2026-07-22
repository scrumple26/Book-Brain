import { describe, expect, it } from "vitest";
import type { Book } from "./types";
import { groupLogRowsByBook, normalizeLogDate, parseReadingLogCsv } from "./readingLog";

const book = (id: string, title: string): Book => ({
  id,
  title,
  author: "A",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  chapters: [],
});

const library = [book("b1", "The Art Of Winning"), book("b2", "Thinking Fast And Slow")];

describe("normalizeLogDate", () => {
  it("passes through ISO dates and converts spreadsheet slashes", () => {
    expect(normalizeLogDate("2026-07-22")).toBe("2026-07-22");
    expect(normalizeLogDate("7/4/2026")).toBe("2026-07-04");
    expect(normalizeLogDate("12/25/2026")).toBe("2026-12-25");
  });

  it("rejects anything else rather than guessing", () => {
    expect(normalizeLogDate("July 4")).toBeNull();
    expect(normalizeLogDate("")).toBeNull();
    expect(normalizeLogDate("2026/07/22")).toBeNull();
  });
});

describe("parseReadingLogCsv", () => {
  it("matches books by title, case- and spacing-insensitively", () => {
    const csv = "Book,Date,Pages\nthe art of  winning,2026-07-22,40";
    const { rows, errors } = parseReadingLogCsv(csv, library);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { bookId: "b1", bookTitle: "The Art Of Winning", entry: { date: "2026-07-22", pages: 40 } },
    ]);
  });

  it("accepts columns in any order", () => {
    const csv = "Pages,Book,Date\n25,Thinking Fast And Slow,2026-07-01";
    const { rows } = parseReadingLogCsv(csv, library);
    expect(rows[0]).toMatchObject({ bookId: "b2", entry: { pages: 25 } });
  });

  it("handles quoted titles containing commas", () => {
    const csv = '"Book","Date","Pages"\n"The Art Of Winning","2026-07-22","40"';
    const { rows, errors } = parseReadingLogCsv(csv, library);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("reports unmatched rows instead of dropping them", () => {
    // Silently losing rows is the failure mode that matters here — you'd have
    // no reason to go looking for the missing pages.
    const csv = "Book,Date,Pages\nSome Other Book,2026-07-22,40\nThe Art Of Winning,2026-07-22,10";
    const { rows, errors } = parseReadingLogCsv(csv, library);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Some Other Book");
  });

  it("reports bad dates and bad page counts by row number", () => {
    const csv = "Book,Date,Pages\nThe Art Of Winning,yesterday,40\nThe Art Of Winning,2026-07-22,lots";
    const { rows, errors } = parseReadingLogCsv(csv, library);
    expect(rows).toEqual([]);
    expect(errors[0]).toContain("Row 2");
    expect(errors[1]).toContain("Row 3");
  });

  it("rejects a file whose header is missing a required column", () => {
    const { rows, errors } = parseReadingLogCsv("Book,Pages\nX,10", library);
    expect(rows).toEqual([]);
    expect(errors[0]).toContain("Book, Date and Pages");
  });

  it("rejects an empty file", () => {
    expect(parseReadingLogCsv("", library).errors[0]).toContain("empty");
  });

  it("rounds fractional page counts", () => {
    const { rows } = parseReadingLogCsv("Book,Date,Pages\nThe Art Of Winning,2026-07-22,40.6", library);
    expect(rows[0].entry.pages).toBe(41);
  });
});

describe("groupLogRowsByBook", () => {
  it("collects entries per book so each book saves once", () => {
    const { rows } = parseReadingLogCsv(
      "Book,Date,Pages\nThe Art Of Winning,2026-07-01,10\nThe Art Of Winning,2026-07-02,20\nThinking Fast And Slow,2026-07-03,5",
      library,
    );
    const grouped = groupLogRowsByBook(rows);
    expect(grouped.get("b1")).toHaveLength(2);
    expect(grouped.get("b2")).toHaveLength(1);
  });
});
