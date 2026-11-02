import { describe, expect, it } from "vitest";
import { EMPTY_VALUES, FIGURE_EMPTY_CLS, FIGURE_LABEL_CLS, FIGURE_STYLE, FIGURE_VALUE_CLS, figureValueClass, isEmptyValue } from "./figure-style";

/** Edit batch C round 2, item 1 (option A): one style for every Facts card, record header figure, and row figure. */
describe("the facts and figures style", () => {
  it("values are 15.5px semibold near-black; labels the small caps at 11px medium, 4px from the value", () => {
    expect(FIGURE_STYLE.value).toEqual({ px: 15.5, weight: 600, color: "#0f172a" });
    expect(FIGURE_STYLE.label).toEqual({ px: 11, weight: 500, gapPx: 4 });
    expect(FIGURE_VALUE_CLS).toBe("text-[15.5px] font-semibold text-[#0f172a]");
    expect(FIGURE_LABEL_CLS).toBe("label-caps figure-label");
  });

  it("empty values are muted gray at medium weight", () => {
    expect(FIGURE_STYLE.empty).toEqual({ weight: 500, color: "#94a3b8" });
    expect(FIGURE_EMPTY_CLS).toContain("text-[#94a3b8]");
    expect(FIGURE_EMPTY_CLS).toContain("font-medium");
    for (const v of ["Not stated", "Not set", "Never", "None"]) {
      expect(EMPTY_VALUES).toContain(v);
      expect(isEmptyValue(v)).toBe(true);
      expect(figureValueClass(v)).toBe(FIGURE_EMPTY_CLS);
    }
    expect(isEmptyValue("not set")).toBe(true);
    expect(isEmptyValue(" Never ")).toBe(true);
    // React children of a fact: the value and an empty note.
    expect(isEmptyValue(["Not stated", null])).toBe(true);
    expect(isEmptyValue(["$6.0M", " (3.5x)"])).toBe(false);
  });

  it("real values stay near-black; numbers and words that only start like an empty one are not empty", () => {
    for (const v of ["$1.4M", "Oct 27 · meeting", "4 days late", "Nonesuch Co", "Never Mind LLC", 0, 3]) {
      expect(isEmptyValue(v)).toBe(false);
      expect(figureValueClass(v)).toBe(FIGURE_VALUE_CLS);
    }
  });

  it("status tones still color the value: amber today, red late or missed, gray none", () => {
    expect(figureValueClass("Today", "today")).toContain("text-status-soon");
    expect(figureValueClass("2 days late", "over")).toContain("text-status-missed");
    expect(figureValueClass("3 of 5", "red")).toContain("text-status-missed");
    // The neutral tone of the record header (OPEN TASKS 3, LAST CONTACT Today · call) is near-black, not gray.
    expect(figureValueClass("3", "none")).toBe(FIGURE_VALUE_CLS);
    expect(figureValueClass("Today · call", "none")).toBe(FIGURE_VALUE_CLS);
    expect(figureValueClass("None", "none")).toBe(FIGURE_EMPTY_CLS);
    // An empty value is gray whatever the tone.
    expect(figureValueClass("None", "today")).toBe(FIGURE_EMPTY_CLS);
    for (const tone of ["plain", "today", "over", "red", "amber"] as const) expect(figureValueClass("x", tone)).toContain("text-[15.5px]");
  });
});
