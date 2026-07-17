import { doc, getDoc, setDoc, increment } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";

// Aqua Avalon API billing: $0.39 per hour of audio, billed per second.
// Hard monthly budget: never let the app spend past the cap. We stop at a
// safety threshold below the cap so rounding/in-flight clips can't tip over.
export const AQUA_RATE_PER_HOUR = 0.39;
export const AQUA_MONTHLY_CAP_USD = 10;
export const AQUA_HARD_STOP_USD = 9;
export const AQUA_MAX_SECONDS_PER_MONTH = Math.floor(
  (AQUA_HARD_STOP_USD / AQUA_RATE_PER_HOUR) * 3600
); // ≈ 83,076 s ≈ 23 hours of audio

export function aquaMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function usageDoc(uid: string) {
  return doc(getFirebaseDb(), "users", uid, "aquaUsage", aquaMonthKey());
}

/** Seconds of audio already sent to Aqua this calendar month. Throws on
 *  permission/network failure so callers can fail closed (disable Aqua). */
export async function fetchAquaSecondsUsed(uid: string): Promise<number> {
  const snap = await getDoc(usageDoc(uid));
  const s = snap.exists() ? (snap.data() as { seconds?: unknown }).seconds : 0;
  return typeof s === "number" && Number.isFinite(s) ? s : 0;
}

/** Record seconds sent to Aqua. Called BEFORE each upload so metering can
 *  only ever overcount, never undercount, relative to the cap. */
export async function addAquaSecondsUsed(uid: string, seconds: number): Promise<void> {
  await setDoc(
    usageDoc(uid),
    { seconds: increment(seconds), updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export function aquaSpendUsd(seconds: number): number {
  return (seconds / 3600) * AQUA_RATE_PER_HOUR;
}
