import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@/lib/accountability/activity";
import { AUTO, calendarEvents, eventOf, localInstant, overlapFor, overlaps, planCalendarMeetings, spanWords, type DayComm } from "@/lib/accountability/calendar-meetings";

const TZ = "America/New_York";
const DAY = "2026-11-24";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const D = "33333333-3333-4333-8333-333333333333";
const row = (id: string, text: string, time: string | null, href: string | null, recordHref: string | null = null): ActivityRow => ({ id, kind: "calendar", text, record: null, time, href, recordHref });
const rows = [
  row("cal:e1", "Call with Thatcher Brown, 30 min", "10:00", `/work/people/${A}`, `/work/deals/${D}`),
  row("cal:e2", "Broker webinar: Q4 listings, 60 min", "14:00", `/work/people/${B}`),
  row("cal:e3", "Dalton Services model review, 45 min", "16:00", `/work/deals/${D}`, `/work/deals/${D}`),
  row("cal:block:9", "Block: screen listings, 60 min", "09:00", null),
  row("cal:e5", "Dentist", "08:00", null),
];
const comm = (o: Partial<DayComm> & { id: string }): DayComm => ({ contactId: null, method: "call", occurredAt: localInstant(DAY, "10:00", TZ), minutes: 20, calendarEventId: null, ...o });

describe("calendar meetings on record (2026-11-24)", () => {
  it("reads a local time as an instant in the owner's time zone", () => {
    expect(localInstant(DAY, "10:00", TZ)).toBe("2026-11-24T15:00:00.000Z");
    expect(localInstant("2026-07-01", "09:30", TZ)).toBe("2026-07-01T13:30:00.000Z");
  });

  it("reads the day's calendar rows as events: a person or a deal, never a block or an unmatched event", () => {
    const ev = calendarEvents(rows, DAY, TZ);
    expect(ev.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(ev[0]).toEqual({ eventId: "e1", rowId: "cal:e1", title: "Call with Thatcher Brown", minutes: 30, start: "2026-11-24T15:00:00.000Z", end: "2026-11-24T15:30:00.000Z", contactId: A, dealId: D });
    expect(ev[2]).toMatchObject({ contactId: null, dealId: D, title: "Dalton Services model review" });
  });

  it("saves an event as a meeting only once its end time has passed; a webinar is saved like any other event", () => {
    const events = calendarEvents(rows, DAY, TZ);
    const at = (hhmm: string) => planCalendarMeetings({ events, comms: [], dropped: new Set(), now: localInstant(DAY, hhmm, TZ) });
    expect(at("09:00").create).toEqual([]);
    expect(at("10:29").create).toEqual([]);
    expect(at("10:30").create.map((e) => e.eventId)).toEqual(["e1"]);
    expect(at("15:00").create.map((e) => e.eventId)).toEqual(["e1", "e2"]);
    expect(at("23:00").create.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
  });

  it("never saves an event twice, and adds a hand-logged meeting at another time to the count", () => {
    const events = calendarEvents(rows, DAY, TZ);
    const now = localInstant(DAY, "23:00", TZ);
    // e1 already saved by the app; a second call with the same person at 3:00 pm is its own meeting.
    const comms = [comm({ id: "c1", contactId: A, method: "meeting", calendarEventId: `${AUTO}e1` }), comm({ id: "c2", contactId: A, occurredAt: localInstant(DAY, "15:00", TZ) })];
    const plan = planCalendarMeetings({ events, comms, dropped: new Set(), now });
    expect(plan.create.map((e) => e.eventId)).toEqual(["e2", "e3"]);
    expect(plan.tie).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("takes a hand-logged call with the same person at an overlapping time as the event's meeting (no second one)", () => {
    const events = calendarEvents(rows, DAY, TZ);
    const now = localInstant(DAY, "11:00", TZ);
    const plan = planCalendarMeetings({ events, comms: [comm({ id: "c1", contactId: A, occurredAt: localInstant(DAY, "10:10", TZ) })], dropped: new Set(), now });
    expect(plan.tie).toEqual([{ commId: "c1", eventId: "e1" }]);
    expect(plan.create).toEqual([]);
    // Another person at the same time is another meeting.
    expect(planCalendarMeetings({ events, comms: [comm({ id: "c1", contactId: B, occurredAt: localInstant(DAY, "10:10", TZ) })], dropped: new Set(), now }).create.map((e) => e.eventId)).toEqual(["e1"]);
    // An email at that time is not the meeting.
    expect(planCalendarMeetings({ events, comms: [comm({ id: "c1", contactId: A, method: "email" })], dropped: new Set(), now }).create.map((e) => e.eventId)).toEqual(["e1"]);
  });

  it("takes the saved meeting away when its row is dropped or its event is gone, and brings it back on Keep", () => {
    const events = calendarEvents(rows, DAY, TZ);
    const now = localInstant(DAY, "23:00", TZ);
    const saved = [comm({ id: "c1", contactId: A, method: "meeting", calendarEventId: `${AUTO}e1` }), comm({ id: "c9", contactId: B, method: "meeting", calendarEventId: `${AUTO}gone` }), comm({ id: "c7", contactId: B, calendarEventId: "e2" })];
    const dropped = planCalendarMeetings({ events, comms: saved, dropped: new Set(["cal:e1"]), now });
    expect(dropped.remove.sort()).toEqual(["c1", "c9"]);
    expect(dropped.create.map((e) => e.eventId)).toEqual(["e3"]);
    // Kept again (the saved meeting is gone by then): it is saved again. A hand-logged meeting is never taken away.
    const kept = planCalendarMeetings({ events, comms: [saved[2]], dropped: new Set(), now });
    expect(kept.create.map((e) => e.eventId)).toEqual(["e1", "e3"]);
    expect(kept.remove).toEqual([]);
    expect(eventOf(`${AUTO}e1`)).toBe("e1");
    expect(eventOf("e2")).toBe("e2");
    expect(eventOf(null)).toBeNull();
  });

  it("finds what a call about to be logged overlaps: the same person's event, else another event (a warning)", () => {
    const events = calendarEvents(rows, DAY, TZ);
    const none = new Set<string>();
    expect(overlapFor(events, none, localInstant(DAY, "10:15", TZ), 20, A).same?.eventId).toBe("e1");
    expect(overlapFor(events, none, localInstant(DAY, "10:15", TZ), 20, B)).toMatchObject({ same: null, other: { eventId: "e1" } });
    expect(overlapFor(events, none, localInstant(DAY, "11:00", TZ), 20, A)).toEqual({ same: null, other: null });
    // A dropped event (it did not happen) is never in the way.
    expect(overlapFor(events, new Set(["cal:e1"]), localInstant(DAY, "10:15", TZ), 20, B)).toEqual({ same: null, other: null });
    expect(overlaps("2026-11-24T15:00:00Z", 30, "2026-11-24T15:30:00Z", 30)).toBe(false);
    expect(spanWords("2026-11-24T19:00:00.000Z", 60, TZ)).toBe("2:00 to 3:00 pm");
    expect(spanWords("2026-11-24T16:30:00.000Z", 60, TZ)).toBe("11:30 am to 12:30 pm");
  });
});
