import { format } from "date-fns";
import { parseDate } from "@/lib/calc/dates";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n: number | string | null | undefined, cents = false): string {
  if (n === null || n === undefined || n === "") return "Not set";
  const v = Number(n);
  if (!Number.isFinite(v)) return "Not set";
  return (cents ? usdCents : usd).format(v);
}

export function num(n: number | string | null | undefined, digits = 1): string {
  if (n === null || n === undefined || n === "") return "Not set";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function pct(n: number | string | null | undefined, digits = 1): string {
  if (n === null || n === undefined || n === "") return "Not set";
  return `${Number(n).toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}

/** Time zone used to show dates and times. Servers run in UTC, so every timestamp is shown in this zone instead. */
export const APP_TIME_ZONE = "America/New_York";

/**
 * The clock reading of an instant in a time zone, as a Date whose local fields match that reading.
 * Only for formatting: the result is not the same instant.
 */
export function wallClock(instant: Date, tz: string = APP_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Format an instant (ISO timestamp or Date) in the app time zone. */
export function formatInZone(value: string | Date, pattern: string, tz: string = APP_TIME_ZONE): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return format(wallClock(d, tz), pattern);
}

export function date(s: string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!s) return "No date";
  try {
    // A plain date (YYYY-MM-DD) has no time zone; a full timestamp is shown as its New York date.
    if (s.length > 10) return formatInZone(s, pattern);
    return format(parseDate(s), pattern);
  } catch {
    return s;
  }
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return formatInZone(s, "MMM d, yyyy h:mm a");
  } catch {
    return s;
  }
}

export function months(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Not decreasing";
  return `${num(n)} months`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
