/**
 * The facts and figures style (Edit batch C round 2, item 1, option A; pure, tested in figure-style.test.ts). One rule
 * for every Facts card, every record header figure (NEXT ACTION, OPEN TASKS, LAST CONTACT, NEXT FOLLOW-UP, FEE), and
 * the figures on list rows (REVENUE, EBITDA, ASKING, LAST CONTACT, NEXT FOLLOW-UP, TASKS, NEXT, FEE, the Targets and
 * End of day figures):
 * - the value: 15.5px, semibold (600), near-black #0f172a;
 * - an empty value ("Not stated", "Not set", "Never", "None" and the like): muted gray #94a3b8, medium (500);
 * - the label: the charcoal small caps (.label-caps) at 11px, medium (500), with a 4px gap between it and the value
 *   (.figure-label in globals.css).
 * Status colors (amber today, red late or missed, green met) still win over the near-black.
 */

export const FIGURE_STYLE = {
  value: { px: 15.5, weight: 600, color: "#0f172a" },
  empty: { weight: 500, color: "#94a3b8" },
  label: { px: 11, weight: 500, gapPx: 4 },
} as const;

/** The words that mean "nothing here yet": shown in the muted gray. */
export const EMPTY_VALUES: readonly string[] = ["Not stated", "Not set", "Never", "None", "Not known", "Not yet", "No figure", "No location", "No pay range", "No date"];

/** True for a value that says nothing is there ("Not stated", "Not set", "Never", "None", ...), any letter case. */
export function isEmptyValue(value: unknown): boolean {
  // React children: ["Not stated", null] reads as "Not stated".
  if (Array.isArray(value)) {
    const parts = value.filter((v) => v !== null && v !== undefined && v !== false && v !== "");
    return parts.length === 1 && isEmptyValue(parts[0]);
  }
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "" || EMPTY_VALUES.some((e) => e.toLowerCase() === v);
}

/** The value's classes: near-black semibold, or the muted gray at medium weight when empty. */
export const FIGURE_VALUE_CLS = "text-[15.5px] font-semibold text-[#0f172a]";
export const FIGURE_EMPTY_CLS = "text-[15.5px] font-medium text-[#94a3b8]";
/** The label's classes: the shared small caps at 11px medium (.figure-label after .label-caps). */
export const FIGURE_LABEL_CLS = "label-caps figure-label";
/** The 4px between the value and its label. */
export const FIGURE_GAP_CLS = "gap-1";

export type FigureTone = "plain" | "today" | "over" | "later" | "none" | "amber" | "red";

/**
 * The value's classes for a tone: amber for today, red for late or missed, the muted gray only for an empty value,
 * near-black otherwise. The neutral tone ("none": OPEN TASKS, LAST CONTACT in the record header) is near-black too:
 * it was the light gray that made those figures hard to read. Size and weight follow FIGURE_STYLE.
 */
export function figureValueClass(value: unknown, tone: FigureTone = "plain"): string {
  if (isEmptyValue(value)) return FIGURE_EMPTY_CLS;
  if (tone === "today" || tone === "amber") return "text-[15.5px] font-semibold text-status-soon";
  if (tone === "over" || tone === "red") return "text-[15.5px] font-semibold text-status-missed";
  return FIGURE_VALUE_CLS;
}
