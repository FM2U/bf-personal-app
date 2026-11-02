import { describe, expect, it } from "vitest";
import {
  contactKindLabel, normalizeRole, OUTREACH_ROLES, roleForDatabase, counterLabel, followUpHint, lastContactLabel, matchesOutreachFilter, matchesPersonSearch, nextDateChoices, nextFollowUpLabel,
  orgRoleLine, outreachFilterCounts, outreachSectionOf, outreachSections, parsePurposes, purposesText, roleLabel, weeklyOutreach, weekdayShort, workWeek, type OutreachPerson,
} from "./outreach";

// 2026-11-03 is a Tuesday.
const today = "2026-11-03";
const p = (id: string, nextFollowUp: string | null, purposes: string[] = [], archived = false): OutreachPerson => ({ id, name: id, nextFollowUp, purposes, archived });
const fmt = (d: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

describe("purposes and roles", () => {
  it("reads purposes from an array or a comma string, in the fixed order, unknown values dropped", () => {
    expect(parsePurposes(["rosara", "off_market_deals", "nope", "rosara"])).toEqual(["off_market_deals", "rosara"]);
    expect(parsePurposes("job_search, consulting")).toEqual(["job_search", "consulting"]);
    expect(parsePurposes(null)).toEqual([]);
    expect(purposesText(["rosara", "off_market_deals"])).toBe("Off-market deals, Rosara");
    expect(purposesText([])).toBe("");
  });

  it("builds the organization and role line", () => {
    expect(orgRoleLine({ organization: "Transworld", roleLabel: "Broker", title: "East Tennessee" })).toBe("Transworld · Broker, East Tennessee");
    expect(orgRoleLine({ organization: null, roleLabel: "Recruiter", title: null })).toBe("Recruiter");
    expect(orgRoleLine({ organization: "Transworld", roleLabel: "Broker", title: "Broker, East Tennessee" })).toBe("Transworld · Broker, East Tennessee");
    expect(orgRoleLine({ organization: "Sullivan Wickley", roleLabel: "Other", title: "Partner" })).toBe("Sullivan Wickley · Partner");
    expect(orgRoleLine({ organization: null, roleLabel: null, title: null })).toBe("");
  });

  it("labels the roles", () => {
    // Edit batch C round 2: Former colleague is Personal network; the old stored key reads as the new role.
    expect(roleLabel("personal_network")).toBe("Personal network");
    expect(roleLabel("former_colleague")).toBe("Personal network");
    expect(roleLabel("cofounder_candidate")).toBe("Co-founder candidate");
    expect(roleLabel("nope")).toBeNull();
  });
});

describe("the sections by next follow-up", () => {
  it("puts each person under Overdue, Due today, Next 7 days, Later, or No date", () => {
    expect(outreachSectionOf({ nextFollowUp: "2026-11-02" }, today)).toBe("overdue");
    expect(outreachSectionOf({ nextFollowUp: "2026-11-03" }, today)).toBe("today");
    expect(outreachSectionOf({ nextFollowUp: "2026-11-10" }, today)).toBe("week");
    expect(outreachSectionOf({ nextFollowUp: "2026-11-11" }, today)).toBe("later");
    expect(outreachSectionOf({ nextFollowUp: null }, today)).toBe("nodate");
  });

  it("sorts each section soonest first then by name, and leaves archived people out", () => {
    const s = outreachSections([p("b", "2026-11-04"), p("a", "2026-11-04"), p("c", "2026-10-30"), p("d", "2026-11-01"), p("e", null), p("gone", "2026-11-03", [], true)], today);
    expect(s.overdue.map((x) => x.id)).toEqual(["c", "d"]);
    expect(s.today).toEqual([]);
    expect(s.week.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.nodate.map((x) => x.id)).toEqual(["e"]);
  });

  it("filters by date section and by purpose, and counts the pills", () => {
    const people = [p("a", "2026-11-03", ["off_market_deals"]), p("b", "2026-11-01", ["job_search"]), p("c", null, ["off_market_deals", "rosara"])];
    expect(matchesOutreachFilter(people[0], "today", today)).toBe(true);
    expect(matchesOutreachFilter(people[1], "over", today)).toBe(true);
    expect(matchesOutreachFilter(people[2], "nodate", today)).toBe(true);
    expect(matchesOutreachFilter(people[2], "rosara", today)).toBe(true);
    expect(matchesOutreachFilter(people[1], "rosara", today)).toBe(false);
    const counts = outreachFilterCounts(people, today);
    expect(counts).toMatchObject({ all: 3, today: 1, over: 1, nodate: 1, off_market_deals: 2, job_search: 1, consulting: 0, rosara: 1 });
    expect(matchesPersonSearch({ name: "Mark Reed", organization: "Transworld" }, "trans")).toBe(true);
    expect(matchesPersonSearch({ name: "Mark Reed" }, "dana")).toBe(false);
  });
});

describe("the weekly counter", () => {
  it("counts emails sent and calls logged to people, Monday to Friday of this week", () => {
    expect(workWeek(today)).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    const comms = [
      { occurredOn: "2026-11-02", method: "email", direction: "outgoing", contactId: "a" },
      { occurredOn: "2026-11-03", method: "call", direction: "outgoing", contactId: "b" },
      { occurredOn: "2026-11-03", method: "email", direction: "incoming", contactId: "a" },
      { occurredOn: "2026-11-01", method: "email", direction: "outgoing", contactId: "a" },
      { occurredOn: "2026-11-07", method: "call", direction: "outgoing", contactId: "a" },
      { occurredOn: "2026-11-04", method: "letter", direction: "outgoing", contactId: "a" },
      { occurredOn: "2026-11-04", method: "email", direction: "outgoing", contactId: null },
      { occurredOn: "2026-11-05", method: "meeting", direction: "both", contactId: "c" },
    ];
    expect(weeklyOutreach(comms, today, 10)).toEqual({ count: 3, target: 10, pct: 30 });
    expect(weeklyOutreach(comms, today, 0).target).toBe(10);
    expect(weeklyOutreach(Array(12).fill(comms[0]), today, 10).pct).toBe(100);
    expect(counterLabel({ count: 4, target: 10 })).toEqual({ before: "Network outreach: ", count: "4", after: " of 10 this week" });
  });
});

describe("the figures and the date choices", () => {
  it("labels the last contact and the next follow-up", () => {
    expect(lastContactLabel("2026-10-20T15:00:00Z", "email", today, fmt)).toBe("Oct 20 · email");
    expect(lastContactLabel("2026-11-03T15:00:00Z", "video", today, fmt)).toBe("Today · video call");
    expect(lastContactLabel(null, null, today, fmt)).toBe("Never");
    expect(contactKindLabel("meeting")).toBe("meeting");
    expect(nextFollowUpLabel("2026-11-03", today, fmt)).toEqual({ text: "Today", tone: "today" });
    expect(nextFollowUpLabel("2026-10-29", today, fmt)).toEqual({ text: "Oct 29", tone: "over" });
    expect(nextFollowUpLabel(null, today, fmt)).toEqual({ text: "None", tone: "none" });
    expect(followUpHint("2026-11-01", today, fmt)).toBe("Overdue by 2 days");
    expect(followUpHint("2026-11-02", today, fmt)).toBe("Overdue by 1 day");
    expect(followUpHint("2026-11-03", today, fmt)).toBe("Due today");
    expect(followUpHint("2026-11-07", today, fmt)).toBe("Due Nov 7");
    expect(followUpHint(null, today, fmt)).toBe("No date set");
  });

  it("offers three dates off the weekend with their weekday", () => {
    expect(weekdayShort("2026-11-03")).toBe("Tue");
    const choices = nextDateChoices(today);
    expect(choices.map((c) => c.date)).toEqual(["2026-11-06", "2026-11-16", "2026-12-03"]);
    expect(choices[0].label(fmt)).toBe("Nov 6 (Fri)");
    // From a Thursday, three days on is a Sunday: moved to Monday.
    expect(nextDateChoices("2026-11-05").map((c) => c.date)).toEqual(["2026-11-09", "2026-11-16", "2026-12-07"]);
  });
});

describe("the Personal network role (Edit batch C round 2, update 0026)", () => {
  it("is in the role list in place of Former colleague", () => {
    expect(OUTREACH_ROLES.map((r) => r.label)).toContain("Personal network");
    expect(OUTREACH_ROLES.map((r) => r.label)).not.toContain("Former colleague");
    expect(OUTREACH_ROLES.map((r) => r.key)).not.toContain("former_colleague");
  });
  it("reads the old key as Personal network", () => {
    expect(normalizeRole("former_colleague")).toBe("personal_network");
    expect(normalizeRole("broker")).toBe("broker");
    expect(normalizeRole("nope")).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });
  it("saves the new key after update 0026 and the old key before it (the database check allows only that one)", () => {
    expect(roleForDatabase("personal_network", true)).toBe("personal_network");
    expect(roleForDatabase("personal_network", false)).toBe("former_colleague");
    expect(roleForDatabase("former_colleague", true)).toBe("personal_network");
    expect(roleForDatabase("broker", false)).toBe("broker");
    expect(roleForDatabase("nope", true)).toBeNull();
  });
});
