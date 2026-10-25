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

export function date(s: string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!s) return "No date";
  try {
    return format(parseDate(s), pattern);
  } catch {
    return s;
  }
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return format(new Date(s), "MMM d, yyyy h:mm a");
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
