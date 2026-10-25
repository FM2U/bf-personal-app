import { addDaysISO, daysBetween } from "./dates";
import { normalizeDescription, merchantFromDescription } from "./csv";
import { round2 } from "./runway";

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const FREQS: { f: Frequency; days: number; tolerance: number; perMonth: number; minCount: number }[] = [
  { f: "weekly", days: 7, tolerance: 2, perMonth: 52 / 12, minCount: 3 },
  { f: "biweekly", days: 14, tolerance: 3, perMonth: 26 / 12, minCount: 3 },
  { f: "monthly", days: 30.4, tolerance: 5, perMonth: 1, minCount: 3 },
  { f: "quarterly", days: 91, tolerance: 10, perMonth: 1 / 3, minCount: 2 },
  { f: "yearly", days: 365, tolerance: 20, perMonth: 1 / 12, minCount: 2 },
];

export type RecurringTxn = { id: string; date: string; amount: number; description: string; merchant_name?: string | null };

export type DetectedSeries = {
  normalizedName: string;
  merchantName: string;
  frequency: Frequency;
  averageAmount: number;
  monthlyCost: number;
  lastDate: string;
  nextExpectedDate: string;
  occurrences: number;
  transactionIds: string[];
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Find repeating charges. Charges are grouped by normalized merchant name. A group is recurring when
 * the typical gap between charges matches a frequency (within tolerance), most gaps match it,
 * and amounts stay within 25% of the typical amount.
 */
export function detectRecurring(txns: RecurringTxn[]): DetectedSeries[] {
  const groups = new Map<string, RecurringTxn[]>();
  for (const t of txns) {
    if (t.amount >= 0) continue; // charges only
    const key = normalizeDescription(t.merchant_name || t.description);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const out: DetectedSeries[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => -t.amount);
    const typical = median(amounts);
    const consistent = sorted.filter((t) => Math.abs(-t.amount - typical) <= typical * 0.25);
    if (consistent.length < 2) continue;
    const gaps: number[] = [];
    for (let i = 1; i < consistent.length; i++) gaps.push(daysBetween(consistent[i - 1].date, consistent[i].date));
    const gap = median(gaps);
    const match = FREQS.find((f) => Math.abs(gap - f.days) <= f.tolerance);
    if (!match || consistent.length < match.minCount) continue;
    const goodGaps = gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance).length;
    if (goodGaps / gaps.length < 0.6) continue;
    const avg = consistent.reduce((s, t) => s + -t.amount, 0) / consistent.length;
    const last = consistent[consistent.length - 1];
    out.push({
      normalizedName: key,
      merchantName: last.merchant_name || merchantFromDescription(last.description),
      frequency: match.f,
      averageAmount: round2(avg),
      monthlyCost: round2(avg * match.perMonth),
      lastDate: last.date,
      nextExpectedDate: addDaysISO(last.date, Math.round(match.days)),
      occurrences: consistent.length,
      transactionIds: consistent.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

/** A series has ended when its next expected date is more than one full cycle in the past. */
export function seriesStatus(nextExpected: string, frequency: Frequency, today: string): "active" | "ended" {
  const f = FREQS.find((x) => x.f === frequency)!;
  return daysBetween(nextExpected, today) > f.days + f.tolerance ? "ended" : "active";
}
