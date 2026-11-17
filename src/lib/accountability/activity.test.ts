import { describe, expect, it } from "vitest";
import { cleanCalendarRows, clock12, cleanDropped, matchCalendar, sortActivity, uniqueIds, type ActivityRow } from "./activity";

const people = [
  { id: "p1", name: "David Aferiat", email: "david@avid.example", href: "/work/people/p1" },
  { id: "p2", name: "Reid", email: null, href: "/work/people/p2" },
];
const records = [
  { id: "d1", name: "Moody & Associates Law Office", href: "/work/deals/d1" },
  { id: "d2", name: "00 Established Testing Laboratory Business", href: "/work/deals/d2" },
];

describe("Today's activity (release 3b, 2026-11-16)", () => {
  it("keeps the calendar events that match a contact or a record, and every block; leaves the rest out", () => {
    const rows = matchCalendar(
      [
        { id: "e1", title: "David + Bram | Souper Jenny's", start: "09:00", end: "10:00", kind: "event", attendees: ["DAVID@avid.example"] },
        { id: "e2", title: "Coffee with David Aferiat", start: "11:00", end: "11:30", kind: "event" },
        { id: "e3", title: "Moody & Associates Law Office: model review", start: "13:00", end: "14:00", kind: "event" },
        { id: "e4", title: "Established Testing Laboratory Business broker call", start: "15:00", end: "15:30", kind: "event" },
        { id: "e5", title: "Apt Lease Renewal Make Decision", start: "11:15", end: "11:45", kind: "event" },
        { id: "e6", title: "Call Reid about the price", start: "16:00", end: "16:15", kind: "event" },
        { id: "b1", title: "Finish the 7-year model", start: "08:00", end: "09:00", kind: "block" },
      ],
      people,
      records,
    );
    expect(rows.map((r) => [r.id, r.record, r.text])).toEqual([
      ["cal:e1", "David Aferiat", "David + Bram | Souper Jenny's, 60 min"],
      ["cal:e2", "David Aferiat", "Coffee with David Aferiat, 30 min"],
      ["cal:e3", "Moody & Associates Law Office", "Moody & Associates Law Office: model review, 60 min"],
      ["cal:e4", "00 Established Testing Laboratory Business", "Established Testing Laboratory Business broker call, 30 min"],
      ["cal:b1", null, "Finish the 7-year model, 60 min"],
    ]);
    // Release 4: a record named in the title is kept as the row's record, also when the link goes to a person.
    expect(rows.map((r) => r.recordHref ?? null)).toEqual([null, null, "/work/deals/d1", "/work/deals/d2", null]);
  });

  it("reads the saved calendar rows back clean (release 4)", () => {
    expect(cleanCalendarRows([{ id: "cal:e3", kind: "calendar", text: "Model review, 60 min", record: "Moody", time: "13:00", href: "/work/deals/d1", recordHref: "/work/deals/d1" }, { id: "comm:1", text: "not a calendar row" }, { id: "cal:x", text: "" }, "junk", { id: "cal:e9", text: "Call", time: "1pm" }])).toEqual([
      { id: "cal:e3", kind: "calendar", text: "Model review, 60 min", record: "Moody", time: "13:00", href: "/work/deals/d1", recordHref: "/work/deals/d1" },
      { id: "cal:e9", kind: "calendar", text: "Call", record: null, time: null, href: null, recordHref: null },
    ]);
    expect(cleanCalendarRows(null)).toEqual([]);
  });

  it("orders timed rows by time, then the rest; keeps the dropped ids clean", () => {
    const row = (id: string, time: string | null): ActivityRow => ({ id, kind: "note", text: id, record: null, time, href: null });
    expect(sortActivity([row("a", null), row("b", "14:00"), row("c", "09:30")]).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(cleanDropped(["cal:e1", "cal:e1", "", 4, null])).toEqual(["cal:e1", "4"]);
    expect(cleanDropped("x")).toEqual([]);
  });

  it("gives repeated ids their own number and shows times as 2:05 pm", () => {
    const row = (id: string): ActivityRow => ({ id, kind: "move", text: id, record: null, time: null, href: null });
    expect(uniqueIds([row("move:A:B"), row("move:A:B"), row("x")]).map((r) => r.id)).toEqual(["move:A:B", "move:A:B:2", "x"]);
    expect([clock12("14:05"), clock12("09:30"), clock12("00:15"), clock12("12:00")]).toEqual(["2:05 pm", "9:30 am", "12:15 am", "12:00 pm"]);
  });
});
