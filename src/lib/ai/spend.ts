/**
 * The month's AI spend in words (Edit batch C, item 13): Settings shows "AI this month: $N of $cap", and the Ask AI
 * panel shows a quiet amber line only when the spend is within 10% of the monthly cap (and the cap is not reached
 * yet; a reached cap has its own message). Pure and tested in src/lib/ai/spend.test.ts; the figures come from
 * aiBudget (src/lib/ai/claude.ts: the ai_usage rows of this month and the lower of the two caps).
 */

/** Within this share of the cap, the panel warns. */
const CAP_WARNING_SHARE = 0.1;

const dollars = (n: number) => `$${(Math.round(Math.max(0, n) * 100) / 100).toFixed(2)}`;

/** "AI this month: $3.42 of $25.00". */
export function aiSpendLine(spent: number, cap: number): string {
  return `AI this month: ${dollars(spent)} of ${dollars(cap)}`;
}

/** Spend within 10% of the cap (at 90% or more), not yet at it. */
export function nearCap(spent: number, cap: number): boolean {
  if (!(cap > 0)) return false;
  return spent >= cap * (1 - CAP_WARNING_SHARE) && spent < cap;
}

/** The panel's quiet amber line, or null when the spend is not near the cap. */
export function capWarning(spent: number, cap: number): string | null {
  return nearCap(spent, cap) ? `${aiSpendLine(spent, cap)}. Close to the monthly cap; the AI stops when it is reached.` : null;
}
