/**
 * Tiny time-distance formatter — replaces date-fns/formatDistanceToNow
 * for the only use we had (one-line "X minutes ago" strings).
 *
 * date-fns is ~70 KB minified; we used exactly one function from it
 * across five files. This is ~30 lines and handles every grain we
 * actually display: seconds → minutes → hours → days → weeks →
 * months → years.
 *
 * Behavior matches date-fns conventions:
 *   - No suffix by default; { addSuffix: true } returns "X ago"
 *     (or "in X" for future dates).
 *   - Accepts Date | string | number — same input shape date-fns took.
 *   - Singular vs plural is handled.
 *   - "less than a minute ago" → "moments ago" because the original
 *     wording was awkward in our queue cards.
 */

export interface FormatDistanceOptions {
  addSuffix?: boolean;
}

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Returns a human-readable elapsed-time string vs. now. */
export function formatDistanceToNow(
  input: Date | string | number,
  options: FormatDistanceOptions = {},
): string {
  const t = input instanceof Date ? input : new Date(input);
  if (isNaN(t.getTime())) return "—";

  const deltaSec = Math.round((Date.now() - t.getTime()) / 1000);
  const past = deltaSec >= 0;
  const abs = Math.abs(deltaSec);

  let core: string;
  if (abs < 30) core = "moments";
  else if (abs < MIN) core = pluralize(abs, "second");
  else if (abs < HOUR) core = pluralize(Math.round(abs / MIN), "minute");
  else if (abs < DAY) core = pluralize(Math.round(abs / HOUR), "hour");
  else if (abs < WEEK) core = pluralize(Math.round(abs / DAY), "day");
  else if (abs < MONTH) core = pluralize(Math.round(abs / WEEK), "week");
  else if (abs < YEAR) core = pluralize(Math.round(abs / MONTH), "month");
  else core = pluralize(Math.round(abs / YEAR), "year");

  if (!options.addSuffix) return core;
  if (core === "moments") return past ? "moments ago" : "in a moment";
  return past ? `${core} ago` : `in ${core}`;
}
