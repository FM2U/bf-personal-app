import { describe, expect, it } from "vitest";
import { ROW_COLS } from "@/components/app/work/ui";

/**
 * The alignment rule (Edit batch B, item 5): every figure and button column on a row has a fixed width sized for its
 * longest text, so the columns sit at the same x on every row. The flow checks measure the x positions in a browser
 * (check-flows.cjs, "Rows line up"); this test keeps the widths fixed and large enough for the longest case.
 */
const px = (cls: string) => Number((cls.match(/\[(\d+)px\]/) ?? [])[1]);
// About 6.6px per character at the 12px to 13.5px sizes the rows use (semibold figures), plus the button padding.
const needed = (text: string, padding = 0) => Math.ceil(text.length * 6.6) + padding;

describe("the fixed row columns", () => {
  it("are fixed widths, not minimums, for the figure columns", () => {
    for (const k of ["due", "minutes", "lastContact", "nextDate", "count", "money"] as const) expect(ROW_COLS[k].cls).toMatch(/^w-\[\d+px\]$/);
  });

  it("hold their longest text", () => {
    expect(px(ROW_COLS.due.cls)).toBeGreaterThanOrEqual(needed("4 days late"));
    expect(px(ROW_COLS.minutes.cls)).toBeGreaterThanOrEqual(needed("120 min"));
    expect(px(ROW_COLS.lastContact.cls)).toBeGreaterThanOrEqual(needed("Oct 27 · meeting", 8));
    expect(px(ROW_COLS.nextDate.cls)).toBeGreaterThanOrEqual(needed("NEXT FOLLOW-UP", 8));
    expect(px(ROW_COLS.money.cls)).toBeGreaterThanOrEqual(needed("Not stated"));
    expect(px(ROW_COLS.count.cls)).toBeGreaterThanOrEqual(needed("99"));
  });

  it("size the buttons for their longest label so Done does not grow into Saving", () => {
    expect(ROW_COLS.button.cls).toMatch(/^min-w-\[\d+px\]$/);
    expect(px(ROW_COLS.button.cls)).toBeGreaterThanOrEqual(needed("Saving", 22));
    expect(px(ROW_COLS.wideButton.cls)).toBeGreaterThanOrEqual(needed("Interested", 22));
    for (const c of Object.values(ROW_COLS)) expect(c.longest.length).toBeGreaterThan(0);
  });
});
