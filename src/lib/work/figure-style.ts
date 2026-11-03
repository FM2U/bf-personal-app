
/** The words that mean "nothing here yet": shown in the muted gray. */
const EMPTY_VALUES: readonly string[] = ["Not stated", "Not set", "Never", "None", "Not known", "Not yet", "No figure", "No location", "No pay range", "No date"];

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
const FIGURE_VALUE_CLS = "text-[15.5px] font-semibold text-[#0f172a]";
const FIGURE_EMPTY_CLS = "text-[15.5px] font-medium text-[#94a3b8]";
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
