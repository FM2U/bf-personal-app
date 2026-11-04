import { describe, expect, it } from "vitest";
import { actionKey, aiOrderPrompt, applyAiOrder, AREAS, areaOf, areaSummary, laneSectionOf, matchesActionSearch, mergeLanes, orderedAtLabel, orderToStore, parseOrderChoice, validateAiOrderReply, type HomeAction } from "./lanes";

const today = "2026-11-03";
const a = (lane: HomeAction["lane"], id: string, over: Partial<HomeAction> = {}): HomeAction => ({ key: actionKey(lane, id), lane, id, name: id, action: "Do it", due: today, minutes: null, meta: "", ...over });

describe("the lanes of Home", () => {
  it("puts a row under Overdue, Due today, or Needs a next action, and leaves a later one out", () => {
    expect(laneSectionOf({ action: "x", due: "2026-11-01" }, today)).toBe("overdue");
    expect(laneSectionOf({ action: "x", due: today }, today)).toBe("today");
    expect(laneSectionOf({ action: null, due: null }, today)).toBe("needs");
    expect(laneSectionOf({ action: "x", due: "2026-11-09" }, today)).toBeNull();
    expect(laneSectionOf({ action: "x", due: null }, today)).toBeNull();
  });

  it("merges every lane into the three sections, soonest first, deals before the other lanes on the same day", () => {
    const rows = [
      a("Rosara", "Market research", { due: today }),
      a("Deals", "Dalton", { due: today }),
      a("People", "Mark Reed", { due: "2026-10-29" }),
      a("Deals", "Meridian", { due: "2026-11-02" }),
      a("Job search", "Harbor", { due: today }),
      a("Consulting", "Sunrise", { due: "2026-11-06" }),
      a("Job search", "Peachtree", { action: null, due: null }),
      a("Deals", "Brightpath", { action: null, due: null }),
    ];
    const s = mergeLanes(rows, today);
    expect(s.overdue.map((r) => r.id)).toEqual(["Mark Reed", "Meridian"]);
    expect(s.today.map((r) => r.id)).toEqual(["Dalton", "Market research", "Harbor"]);
    expect(s.needs.map((r) => r.id)).toEqual(["Brightpath", "Peachtree"]);
    expect(matchesActionSearch(rows[0], "market")).toBe(true);
    expect(matchesActionSearch(rows[0], "do it")).toBe(false);
    expect(matchesActionSearch(rows[0], "harbor")).toBe(false);
  });
});

describe("the AI order", () => {
  const keys = ["deal:a", "job:b", "person:c", "project:d"];

  it("reads the reply, drops unknown and repeated keys, keeps one reason per key, and puts the rows the AI left out at the end", () => {
    const r = validateAiOrderReply({ order: [{ key: "job:b", reason: "The call is at 2:00" }, { key: "deal:a", reason: "Due today and the broker goes quiet after 5 days" }, { key: "nope:x", reason: "x" }, { key: "job:b", reason: "twice" }] }, keys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.order).toEqual(["job:b", "deal:a", "person:c", "project:d"]);
    expect(r.value.reasons).toEqual({ "job:b": "The call is at 2:00", "deal:a": "Due today and the broker goes quiet after 5 days" });
  });

  it("accepts a plain list of keys and a list under items, trims a long reason, and fails when nothing matches", () => {
    const r = validateAiOrderReply(["person:c", "deal:a"], keys);
    expect(r.ok && r.value.order).toEqual(["person:c", "deal:a", "job:b", "project:d"]);
    const long = validateAiOrderReply({ items: [{ key: "deal:a", reason: "x".repeat(400) }] }, keys);
    expect(long.ok && long.value.reasons["deal:a"].length).toBe(160);
    expect(validateAiOrderReply({ order: [{ key: "zzz", reason: "no" }] }, keys)).toEqual({ ok: false, error: "no key in the reply matches a row on the page" });
    expect(validateAiOrderReply({ wrong: 1 }, keys).ok).toBe(false);
    expect(validateAiOrderReply("text", keys).ok).toBe(false);
  });

  it("reads plain-text lines (the reader's items): the key named in the line, the rest as the reason", () => {
    const r = validateAiOrderReply({ items: ["1. key=job:b | the call is at 2:00", "deal:a: due today and the broker is quiet", "something without a key"] }, keys);
    expect(r.ok && r.value.order).toEqual(["job:b", "deal:a", "person:c", "project:d"]);
    expect(r.ok && r.value.reasons).toEqual({ "job:b": "the call is at 2:00", "deal:a": "due today and the broker is quiet" });
  });

  it("applies a cached order to the rows on the page: a row the cache does not know goes to the end, a cached key that is gone is skipped", () => {
    const rows = [{ key: "deal:a" }, { key: "job:b" }, { key: "person:c" }, { key: "job:new" }];
    expect(applyAiOrder(rows, ["person:c", "gone:x", "deal:a", "job:b"]).map((r) => r.key)).toEqual(["person:c", "deal:a", "job:b", "job:new"]);
  });

  it("labels when the order was made, remembers the choice, and asks the AI with every row's key and facts", () => {
    expect(orderedAtLabel("2026-11-03T09:10:00Z", today, 9)).toBe("Ordered by the AI this morning");
    expect(orderedAtLabel("2026-11-03T09:10:00Z", today, 14)).toBe("Ordered by the AI this afternoon");
    expect(orderedAtLabel("2026-11-03T09:10:00Z", today, 19)).toBe("Ordered by the AI this evening");
    expect(orderedAtLabel("2026-11-02T09:10:00Z", today, 9)).toBe("Ordered by the AI yesterday");
    const prompt = aiOrderPrompt([a("Deals", "Dalton", { minutes: 60, meta: "CIM review, HVAC", waitingOn: "Rachel Kim", waitDays: 3, dayInStage: 4 }), a("Job search", "Harbor", { meta: "Conversation" })], today);
    expect(prompt).toContain("TASK: ai_order");
    expect(prompt).toContain("key=deal:Dalton");
    expect(prompt).toContain("waiting_on=Rachel Kim for 3 days");
    expect(prompt).toContain("minutes=60");
    expect(prompt).toContain("key=job:Harbor");
    expect(prompt).not.toContain("—");
  });
});

describe("the order choice: each new day starts on Soonest first (approved 2026-11-04)", () => {
  it("keeps By the AI for the rest of the day it was picked", () => {
    expect(parseOrderChoice(orderToStore("ai", today), today)).toBe("ai");
    expect(parseOrderChoice(orderToStore("soonest", today), today)).toBe("soonest");
  });
  it("starts the next day on Soonest first", () => {
    expect(parseOrderChoice(orderToStore("ai", "2026-11-02"), today)).toBe("soonest");
  });
  it("reads nothing saved, an older plain value, or junk as Soonest first", () => {
    expect(parseOrderChoice(null, today)).toBe("soonest");
    expect(parseOrderChoice("ai", today)).toBe("soonest");
    expect(parseOrderChoice("junk", today)).toBe("soonest");
    expect(parseOrderChoice(JSON.stringify({ choice: "ai" }), today)).toBe("soonest");
  });
});

describe("the Area filter on Work on now (2026-11-04)", () => {
  it("lists the seven areas in the window's order", () => {
    expect(AREAS.map((x) => x.label)).toEqual(["Deals", "Contacts", "Rosara", "Job search", "Consulting", "To-dos", "Tasks"]);
  });
  it("puts each row in its area; a to-do on a record is a Task", () => {
    expect(areaOf("Deals")).toBe("deals");
    expect(areaOf("People")).toBe("contacts");
    expect(areaOf("Job search")).toBe("job-search");
    expect(areaOf("To-dos")).toBe("todos");
    expect(areaOf("To-dos", true)).toBe("tasks");
  });
  it("sums up the ticks in plain words", () => {
    expect(areaSummary([])).toBe("Showing every area");
    expect(areaSummary(["contacts", "deals"])).toBe("Showing: Deals or Contacts");
  });
});

/** Edit batch C round 2 (approved 2026-11-02): personal to-dos due today or earlier join Next actions. */
describe("to-dos on Home's Next actions", () => {
  it("merge with the other lanes by due date (no minutes), after the other lanes on the same day", () => {
    const rows = [
      a("To-dos", "Renew the car registration", { due: "2026-10-30" }),
      a("Deals", "Dalton", { due: today }),
      a("To-dos", "Call the dentist", { due: today }),
      a("People", "Mark Reed", { due: "2026-11-01" }),
      a("To-dos", "Book flights", { due: "2026-11-05" }),
    ];
    const s = mergeLanes(rows, today);
    expect(s.overdue.map((r) => r.id)).toEqual(["Renew the car registration", "Mark Reed"]);
    expect(s.today.map((r) => r.id)).toEqual(["Dalton", "Call the dentist"]);
    expect(s.needs).toEqual([]);
    expect([...s.overdue, ...s.today].filter((r) => r.lane === "To-dos").every((r) => r.minutes === null)).toBe(true);
  });
  it("are in the AI order prompt like any other row", () => {
    const p = aiOrderPrompt([a("To-dos", "t9", { name: "Call the dentist", action: "Call the dentist" })], today);
    expect(p).toContain("key=todo:t9 | area=To-dos | name=Call the dentist");
    expect(validateAiOrderReply({ order: [{ key: "todo:t9", reason: "Two minutes" }] }, ["todo:t9"])).toEqual({ ok: true, value: { order: ["todo:t9"], reasons: { "todo:t9": "Two minutes" } } });
  });
});
