import { describe, expect, it } from "vitest";
import { clockShort, dayBlocks, dayLayout, dayPosition, hourLabel, type DayEvent } from "./day-view";

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

  it("shows 8 am to 6 pm, widened to whole hours around earlier or later events", () => {
    expect(dayLayout([ev("a", "10:00", "11:00")])).toMatchObject({ fromHour: 8, toHour: 18 });
    expect(dayLayout([ev("a", "07:15", "07:45"), ev("b", "18:30", "19:10")])).toMatchObject({ fromHour: 7, toHour: 20 });
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
