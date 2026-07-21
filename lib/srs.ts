import { QuizCard } from "./types";

// SM-2-lite spaced repetition. Kept deliberately small: four grades map to an
// ease adjustment + next interval. All scheduling fields on QuizCard are
// optional, so cards created before scheduling existed simply read as "due now."

export type Grade = "again" | "hard" | "good" | "easy";

const DAY_MS = 86_400_000;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

// A card is due if it has never been scheduled or its due date has arrived.
export function isDue(card: QuizCard, on: string = todayISO()): boolean {
  return !card.dueDate || card.dueDate <= on;
}

// Sort key: most-overdue first, unscheduled ("") treated as maximally due.
export function dueSortKey(card: QuizCard): string {
  return card.dueDate ?? "";
}

// Apply a grade and return the card with updated scheduling fields.
export function schedule(card: QuizCard, grade: Grade): QuizCard {
  const ease = card.easeFactor ?? 2.5;
  const prev = card.intervalDays ?? 0;
  let newEase = ease;
  let interval: number;

  switch (grade) {
    case "again":
      newEase = Math.max(1.3, ease - 0.2);
      interval = 0; // relearn — stays due today
      break;
    case "hard":
      newEase = Math.max(1.3, ease - 0.15);
      interval = prev === 0 ? 1 : Math.max(1, Math.round(prev * 1.2));
      break;
    case "good":
      interval = prev === 0 ? 1 : Math.round(prev * newEase);
      break;
    case "easy":
      newEase = ease + 0.15;
      interval = prev === 0 ? 3 : Math.round(prev * newEase * 1.3);
      break;
  }

  return {
    ...card,
    easeFactor: Number(newEase.toFixed(2)),
    intervalDays: interval,
    dueDate: addDaysISO(interval),
    lastReviewedAt: new Date().toISOString(),
  };
}

// Fresh scheduling for a newly created card: due immediately.
export function newSchedule(): Pick<QuizCard, "dueDate" | "intervalDays" | "easeFactor"> {
  return { dueDate: todayISO(), intervalDays: 0, easeFactor: 2.5 };
}
