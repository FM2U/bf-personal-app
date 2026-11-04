import { describe, expect, it } from "vitest";
import { clickTile, defaultTile, selectedTile, tileAfterFilter } from "./tiles";

const tiles = (over: number, today: number, needs: number) => [
  { key: "overdue" as const, count: over },
  { key: "today" as const, count: today },
  { key: "needs" as const, count: needs },
];

describe("the status tiles that work like tabs (2026-11-04)", () => {
  it("selects the first tile with items at the start", () => {
    expect(defaultTile(tiles(5, 15, 2))).toBe("overdue");
    expect(defaultTile(tiles(0, 15, 2))).toBe("today");
    expect(defaultTile(tiles(0, 0, 2))).toBe("needs");
  });
  it("selects the first tile when every tile is empty", () => {
    expect(defaultTile(tiles(0, 0, 0))).toBe("overdue");
  });
  it("keeps the selected tile after a Filter tick while it has items", () => {
    expect(tileAfterFilter("today", tiles(0, 3, 2))).toBe("today");
  });
  it("moves to the first tile with items when a Filter tick drops the selected tile to 0", () => {
    expect(tileAfterFilter("today", tiles(0, 0, 2))).toBe("needs");
    expect(tileAfterFilter("overdue", tiles(0, 4, 0))).toBe("today");
  });
  it("shows no tile selected while ordered By the AI", () => {
    expect(selectedTile("today", tiles(5, 15, 2), "ai")).toBeNull();
    expect(selectedTile(null, tiles(5, 15, 2), "ai")).toBeNull();
  });
  it("shows the chosen tile, or the default when none was chosen", () => {
    expect(selectedTile("needs", tiles(5, 15, 2))).toBe("needs");
    expect(selectedTile(null, tiles(0, 15, 2))).toBe("today");
  });
  it("a tile click goes back to Soonest first with that tile; a click on the selected tile changes nothing", () => {
    expect(clickTile({ order: "ai", selected: null }, "today")).toEqual({ order: "soonest", selected: "today", changed: true });
    expect(clickTile({ order: "soonest", selected: "overdue" }, "needs")).toEqual({ order: "soonest", selected: "needs", changed: true });
    expect(clickTile({ order: "soonest", selected: "overdue" }, "overdue").changed).toBe(false);
  });
});
