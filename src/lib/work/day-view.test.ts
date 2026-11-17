import { describe, expect, it } from "vitest";
import { blockNeed, clockShort, dayBlocks, dayLayout, dayPosition, dayY, GAP_PX, hourHeight, hourLabel, MAX_HOUR_PX, nowY, placeBlocks, splitDay, type DayEvent } from "./day-view";

const ev = (id: string, start: string, end: string, kind: DayEvent["kind"] = "event"): DayEvent => ({ id, title: id, start, end, kind });

describe("Today's calendar as a day view (release H2, 2026-11-17)", () => {
  it("keeps events alone when they do not overlap, and puts a chain of overlaps in one shared block", () => {
    const blocks = dayBlocks([ev("lunch", "12:00", "13:00"), ev("eta", "08:00", "09:00", "block"), ev("start", "08:30", "09:00"), ev("bram", "10:00", "10:15"), ev("switch", "11:00", "12:30"), ev("apt", "11:15", "11:45"), ev("margins", "12:00", "13:00"), ev("care", "13:00", "14:00")]);
    expect(blocks.map((b) => b.events.map((e) => e.id))).toEqual([["eta", "start"], ["bram"], ["switch", "apt", "lunch", "margins"], ["care"]]);
    expect(blocks[2]).toMatchObject({ start: 11 * 60, end: 13 * 60 });
  });

  it("does not group events that only touch (one ends as the next starts)", () => {
    expect(dayBlocks([ev("a", "09:00", "10:00"), ev("b", "10:00", "11:00")]).length).toBe(2);
  });

  it("reads an end before its start as a 15-minute event", () => {
    expect(dayBlocks([ev("a", "09:00", "09:00")])[0]).toMatchObject({ start: 540, end: 555 });
  });

  it("splits the day: early, the working day (8 to 6), evening, all day (Bram's 9:15 pm concert no longer stretches the day)", () => {
    const s = splitDay([ev("concert", "21:15", "22:45"), ev("gym", "06:30", "07:30"), ev("bram", "10:00", "10:15"), ev("late", "17:30", "18:30"), ev("trip", "00:00", "23:59")]);
    expect(s.early.map((e) => e.id)).toEqual(["gym"]);
    expect(s.day.map((e) => e.id)).toEqual(["bram", "late"]);
    expect(s.evening.map((e) => e.id)).toEqual(["concert"]);
    expect(s.allDay.map((e) => e.id)).toEqual(["trip"]);
    expect(dayLayout(s.day)).toMatchObject({ fromHour: 8, toHour: 18 });
  });

  it("draws each hour tall enough for its rows, so every event of a shared block shows", () => {
    const layout = dayLayout([ev("eta", "08:00", "09:00", "block"), ev("start", "08:30", "09:00"), ev("bram", "10:00", "10:15")]);
    const px = hourHeight(layout, 440);
    const placed = placeBlocks(layout, px);
    expect(placed.blocks[0].height).toBeGreaterThanOrEqual(blockNeed(placed.blocks[0]));
    expect(placed.blocks[1].top).toBeGreaterThanOrEqual(placed.blocks[0].top + placed.blocks[0].height + GAP_PX);
  });

  it("fills the column when the events need less, and caps the hour; dense blocks push later ones down instead", () => {
    const quiet = dayLayout([ev("a", "10:00", "11:00")]);
    expect(hourHeight(quiet, 700)).toBe(70);
    const dense = dayLayout([ev("a", "09:00", "09:10"), ev("b", "09:10", "09:20"), ev("c", "09:20", "09:30")]);
    expect(hourHeight(dense, 400)).toBe(MAX_HOUR_PX);
    const placed = placeBlocks(dense, MAX_HOUR_PX).blocks;
    for (let i = 1; i < placed.length; i++) expect(placed[i].top).toBeGreaterThanOrEqual(placed[i - 1].top + placed[i - 1].height + GAP_PX);
  });

  it("keeps the red line with the blocks when a busy block pushed the next ones down", () => {
    const busy = Array.from({ length: 10 }, (_, i) => ev(`m${i}`, "09:00", "09:30"));
    const layout = dayLayout([...busy, ev("late", "10:00", "11:00")]);
    const px = hourHeight(layout, 400);
    const placed = placeBlocks(layout, px).blocks;
    const late = placed[1];
    // 10:15 is a quarter into the 10:00 block, wherever that block was pushed to.
    expect(nowY(placed, layout, px, 10 * 60 + 15)).toBeCloseTo(late.top + late.height / 4);
    // Before any block, the line sits on the hours.
    expect(nowY(placed, layout, px, 8 * 60 + 30)).toBeCloseTo(dayY(8 * 60 + 30, layout, px));
    // After a pushed block, it never sits above that block's bottom.
    expect(nowY(placed, layout, px, 9 * 60 + 40)).toBeGreaterThanOrEqual(placed[0].top + placed[0].height);
  });

  it("raises the hour for an event that runs past 6 pm, so its block ends at the 6 pm line", () => {
    const layout = dayLayout([ev("a", "17:30", "19:00")]);
    const px = hourHeight(layout, 400);
    const placed = placeBlocks(layout, px);
    expect(placed.blocks[0].top + placed.blocks[0].height).toBeLessThanOrEqual(dayY(18 * 60, layout, px) + 1);
  });

  it("places times on the day and writes them the short way", () => {
    expect(dayPosition(13 * 60, { fromHour: 8, toHour: 18 })).toBeCloseTo(0.5);
    expect(dayPosition(6 * 60, { fromHour: 8, toHour: 18 })).toBe(0);
    expect(clockShort(9 * 60 + 58)).toBe("9:58");
    expect(clockShort(12 * 60)).toBe("12:00");
    expect(clockShort(13 * 60 + 5)).toBe("1:05");
    expect([hourLabel(8), hourLabel(12), hourLabel(13)]).toEqual(["8", "12", "1"]);
  });
});
