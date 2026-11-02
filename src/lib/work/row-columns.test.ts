import { describe, expect, it } from "vitest";
import { ROW_COLS, ROW_GRIDS, TEXT_GAP } from "@/components/app/work/ui";

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
    // Edit batch C: the small-caps label NEXT FOLLOW-UP shows in full (11.5px, 0.09em letter spacing: about 8.6px a letter).
    expect(px(ROW_COLS.nextDate.cls)).toBeGreaterThanOrEqual(Math.ceil("NEXT FOLLOW-UP".length * 8.6));
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

/**
 * Edit batch C (items 4 and 8): Outreach, Targets, and End of day rows keep a reserved 32px gap between the text and
 * the first figure or mark column. The grids are parsed here and laid out as a browser would (the text column takes
 * what is left), for rows with short and long text and for several card widths: the fixed columns land at the same x
 * on every row, and the text's right edge is always at least 32px left of the mark or figure column. The flow checks
 * measure the same in a browser (check-flows.cjs, "Edit batch C: rows").
 */
type Track = { fr: true } | { px: number };
const tracks = (cls: string): Track[] => {
  const inner = (cls.match(/grid-cols-\[(.+)\]/) ?? [])[1];
  return inner.split("_").map((t) => (t === "minmax(0,1fr)" ? { fr: true as const } : { px: Number(t.replace("px", "")) }));
};
/** The left x of every column and the text's right edge, for a card content width; the text column never grows past its share. */
const layout = (grid: { cls: string; gap: number; textMargin: number }, width: number, textNeeds: number) => {
  const t = tracks(grid.cls);
  const fixed = t.reduce((s, x) => s + ("px" in x ? x.px : 0), 0) + grid.gap * (t.length - 1);
  const textCol = width - fixed;
  const xs: number[] = [];
  let x = 0;
  for (const tr of t) {
    xs.push(x);
    x += ("px" in tr ? tr.px : textCol) + grid.gap;
  }
  // Text wraps inside its cell: its right edge is the cell's edge less the margin, however long the text.
  const textRight = Math.min(textNeeds, textCol - grid.textMargin);
  return { xs, textRight };
};

describe("the fixed gap before the figure and mark columns (Edit batch C)", () => {
  it("is 32px, as one class", () => {
    expect(TEXT_GAP.px).toBe(32);
    expect(TEXT_GAP.cls).toBe("sm:gap-x-8");
  });

  for (const [name, grid] of Object.entries(ROW_GRIDS)) {
    it(`${name} rows: text column first and flexible, every other column fixed`, () => {
      const t = tracks(grid.cls);
      expect("fr" in t[0]).toBe(true);
      for (const tr of t.slice(1)) expect("px" in tr && tr.px > 0).toBe(true);
      expect(grid.gap + grid.textMargin).toBeGreaterThanOrEqual(TEXT_GAP.px);
      expect(grid.gapCls).toMatch(new RegExp(`gap-x-${grid.gap / 4}$`));
      expect(grid.textMarginCls).toMatch(new RegExp(`mr-${grid.textMargin / 4}$`));
    });

    it(`${name} rows: the mark and figure columns sit at the same x with short and long text, 32px clear of the text`, () => {
      for (const width of [460, 560, 900]) {
        const short = layout(grid, width, 90);
        const long = layout(grid, width, 4000);
        expect(long.xs).toEqual(short.xs);
        for (const l of [short, long]) expect(l.xs[1] - l.textRight).toBeGreaterThanOrEqual(TEXT_GAP.px);
      }
    });
  }

  it("Outreach rows: the figures keep their fixed widths (LAST CONTACT and NEXT FOLLOW-UP), so they start at the same x on every row", () => {
    expect(ROW_COLS.lastContact.cls).toMatch(/^w-\[\d+px\]$/);
    expect(ROW_COLS.nextDate.cls).toMatch(/^w-\[\d+px\]$/);
  });
});
