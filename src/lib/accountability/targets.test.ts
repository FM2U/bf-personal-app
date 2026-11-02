import { describe, expect, it } from "vitest";
import {
  askedForReason, judgedMark, mostMissedIn, reportTiles, MARK_WORD, cadenceLine, countIn, countsLine, targetPill, todayStrip, countedDays, DEFAULT_TARGETS, dayNumbers, EMPTY_FACTS, figure, judgeDay, judgedOn, judgeWeek, markOf, missedLine, metThisWeek, mostMissed, noReasonText, owedFromLastClosed, owedReasons, pastWeeks, reportSummary, statusItems, stripOf, targetView, tileEodLine, tileTargetLine, tileTargets, todayTiles, tomorrowLabel, weekNumbers, weekTiles, workWeekOf,
  type Facts, type Target,
} from "./targets";
import { dealBullets, pillOf, reportInnerHtml, reportSubject, reportText, targetLine, type ReportData } from "./report-email";
import { validateReasonsReply } from "./ask-ai";

// Friday, Nov 6, 2026 (the week of Mon Nov 2 to Fri Nov 6).
const FRI = "2026-11-06";
const WED = "2026-11-04";
const targets: Target[] = DEFAULT_TARGETS.map((t, i) => ({ ...t, id: `t${i + 1}` }));
const byName = (name: string) => targets.find((t) => t.name === name)!;

/** A week: screened listings on four days, outreach 4 of 10, two broker contacts, one late follow-up, two moves, no focus done. */
const facts: Facts = {
  screened: [
    ...["2026-11-02", "2026-11-02", "2026-11-02", "2026-11-02", "2026-11-02"].map((on, i) => ({ on, outcome: i === 4 ? ("interested" as const) : ("passed" as const), name: `L${i}`, reason: i === 4 ? null : "Too small" })),
    { on: "2026-11-03", outcome: "passed", name: "Tue 1", reason: "Retail" },
    { on: "2026-11-03", outcome: "passed", name: "Tue 2", reason: "Retail" },
    ...[1, 2, 3, 4].map((i) => ({ on: "2026-11-04", outcome: "passed" as const, name: `Wed ${i}`, reason: "Too small" })),
    ...[1, 2, 3, 4, 5].map((i) => ({ on: "2026-11-05", outcome: "passed" as const, name: `Thu ${i}`, reason: "Location" })),
    { on: FRI, outcome: "passed", name: "Fri 1", reason: "Too small" },
    { on: FRI, outcome: "passed", name: "Fri 2", reason: "Retail" },
    { on: FRI, outcome: "interested", name: "Industrial Filtration Distributor", reason: null },
    // Last week: 25 (met every day).
    ...["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((on) => [1, 2, 3, 4, 5].map((i) => ({ on, outcome: "passed" as const, name: `LW ${on} ${i}`, reason: "Too small" }))),
  ],
  moves: [
    { on: FRI, name: "Dalton Services", from: "CIM review", to: "Seller call", keyFinding: "70% of revenue is recurring maintenance contracts", lane: "Deals" },
    { on: "2026-11-04", name: "Meridian Industrial Coatings", from: "Seller call", to: "Model", keyFinding: null, lane: "Deals" },
    { on: "2026-11-02", name: "BrightPath Home Care", from: "Interested", to: "NDA signed", keyFinding: null, lane: "Deals" },
    { on: "2026-10-29", name: "Pinecrest Landscaping", from: "Model", to: "IOI or LOI", keyFinding: null, lane: "Deals" },
  ],
  comms: [
    { on: FRI, method: "call", contactId: "p1", contactName: "Priya Natarajan", broker: false },
    { on: FRI, method: "call", contactId: "b1", contactName: "Carla Jenkins", broker: true },
    { on: FRI, method: "email", contactId: "p2", contactName: "Tom Baker", broker: false },
    { on: FRI, method: "email", contactId: null, contactName: null, broker: false },
    { on: "2026-11-03", method: "email", contactId: "b2", contactName: "Rachel Kim", broker: true },
    { on: "2026-11-02", method: "email", contactId: "b2", contactName: "Rachel Kim", broker: true },
    { on: "2026-11-01", method: "email", contactId: "p3", contactName: "Sunday Person", broker: false },
    { on: "2026-10-28", method: "call", contactId: "p4", contactName: "Last Week", broker: false },
  ],
  followUps: [
    { on: FRI, onTime: true, name: "Priya Natarajan" },
    { on: "2026-11-04", onTime: false, name: "Mark Reed" },
    { on: "2026-11-02", onTime: true, name: "Dana Whitfield" },
  ],
  actionsDone: [
    { on: FRI, name: "Meridian Industrial Coatings", label: "Finish the model" },
    { on: FRI, name: "Dalton Services", label: "Call Carla" },
    { on: "2026-11-03", name: "BrightPath Home Care", label: "Sign the NDA" },
  ],
  focusDone: [{ on: "2026-10-29", text: "KarmaKare landing page" }],
};

describe("counting from the facts", () => {
  it("counts listings screened with passed and Interested in the detail", () => {
    const c = countIn("listings_screened", facts, FRI, FRI);
    expect(c.value).toBe(3);
    expect(c.detail).toBe("2 passed (Too small, Retail), 1 Interested: Industrial Filtration Distributor");
    expect(countIn("listings_screened", facts, "2026-11-02", "2026-11-06").value).toBe(19);
  });
  it("counts brokers once each, emails, calls, and outreach on weekdays only", () => {
    expect(countIn("brokers_contacted", facts, "2026-11-02", FRI)).toMatchObject({ value: 2, detail: "Carla Jenkins, Rachel Kim" });
    expect(countIn("emails_sent", facts, FRI, FRI)).toMatchObject({ value: 2 });
    expect(countIn("calls_logged", facts, FRI, FRI)).toMatchObject({ value: 2, detail: "Priya Natarajan, Carla Jenkins" });
    // The email with no person and the Sunday email do not count toward outreach.
    expect(countIn("outreach_contacts", facts, "2026-11-01", FRI).value).toBe(5);
  });
  it("follow-ups on time as a percent, with the late ones named; 100% when none were due", () => {
    expect(countIn("follow_ups_on_time", facts, "2026-11-02", FRI)).toMatchObject({ value: 67, detail: "2 of 3 · one late: Mark Reed", parts: { done: 3, onTime: 2 } });
    expect(countIn("follow_ups_on_time", EMPTY_FACTS, "2026-11-02", FRI)).toMatchObject({ value: 100, detail: "none due" });
  });
  it("deals moved, next actions done, and the Rosara focus", () => {
    expect(countIn("deals_moved", facts, "2026-11-02", FRI)).toMatchObject({ value: 3, detail: "Dalton, Meridian, BrightPath" });
    expect(countIn("next_actions_done", facts, FRI, FRI).value).toBe(2);
    expect(countIn("rosara_focus_done", facts, "2026-10-26", "2026-10-30")).toMatchObject({ value: 1, detail: "KarmaKare landing page, done Thursday" });
    expect(countIn("rosara_focus_done", facts, "2026-11-02", FRI).value).toBe(0);
  });
  it("the cadence line and the figure", () => {
    expect(cadenceLine(byName("Listings screened"))).toBe("Per weekday · target 5 · counts Pass or Interested on Screen listings");
    expect(cadenceLine(byName("Follow-ups done on time"))).toBe("Per week · target 100% · counts outreach follow-ups done on or before their date");
    expect(figure(byName("Listings screened"), 3)).toBe("3 of 5");
    expect(figure(byName("Follow-ups done on time"), 86)).toBe("86%");
    expect(figure(byName("Rosara focus done"), 1)).toBe("Done");
    expect(figure(byName("Rosara focus done"), 0)).toBe("Not yet");
  });
});

describe("judging: weekday versus weekly, the status mark", () => {
  it("a per-weekday target is judged every weekday, a per-week one on Friday", () => {
    expect(judgedOn({ cadence: "day" }, WED)).toBe(true);
    expect(judgedOn({ cadence: "day" }, "2026-11-07")).toBe(false);
    expect(judgedOn({ cadence: "week" }, WED)).toBe(false);
    expect(judgedOn({ cadence: "week" }, FRI)).toBe(true);
  });
  it("met when the figure reaches the target, missed once the period ended or End of day judged it, under way otherwise", () => {
    const t = { number: 5 };
    expect(markOf(t, 5, FRI, FRI)).toBe("met");
    expect(markOf(t, 3, FRI, FRI)).toBe("now");
    expect(markOf(t, 3, FRI, FRI, true)).toBe("missed");
    expect(markOf(t, 3, "2026-11-05", FRI)).toBe("missed");
  });
  it("judgeDay on a Wednesday judges the weekday targets only; on Friday every target", () => {
    const wed = judgeDay(targets, facts, WED);
    expect(wed.find((j) => j.name === "Listings screened")).toMatchObject({ value: 4, met: false, judged: true, figure: "4 of 5", line: "Per weekday · target 5 · this week 11 of 15" });
    expect(wed.find((j) => j.name === "Network outreach")).toMatchObject({ judged: false, value: 5 });
    expect(askedForReason(wed).map((j) => j.name)).toEqual(["Listings screened"]);
    const fri = judgeDay(targets, facts, FRI);
    expect(fri.filter((j) => j.judged)).toHaveLength(6);
    expect(askedForReason(fri).map((j) => j.name)).toEqual(["Listings screened", "Network outreach"]);
    expect(fri.find((j) => j.name === "Deals moved a stage")).toMatchObject({ met: true, figure: "3 of 2" });
    expect(fri.find((j) => j.name === "Rosara focus done")).toMatchObject({ met: false, figure: "Not yet" });
  });
  it("reasons left: only missed Commitments with an empty box; the status line words", () => {
    const fri = judgeDay(targets, facts, FRI);
    expect(owedReasons(fri, {}).map((j) => j.name)).toEqual(["Listings screened", "Network outreach"]);
    expect(owedReasons(fri, { t1: "Deal work took the block", t3: " " }).map((j) => j.name)).toEqual(["Network outreach"]);
    expect(statusItems(2, "", "open", null).map((i) => `${i.label} ${i.word ?? "-"} ${i.tone}`)).toEqual(["Reasons 2 left left", "Tomorrow's line empty left", "Approve and send - off"]);
    expect(statusItems(0, "Monday: the model", "sent", "5:41 pm").map((i) => `${i.word}`)).toEqual(["done", "done", "sent 5:41 pm"]);
    expect(noReasonText(2, "Jake")).toBe('2 commitments have no reason yet. Jake sees "(reason still to give)".');
    expect(noReasonText(1, "Jake")).toMatch(/^1 commitment has no reason yet/);
  });
});

describe("reasons owed from a skipped day", () => {
  const judged = judgeDay(targets, facts, WED);
  const missedCommit = judged.find((j) => j.judged && !j.met && j.commitment) ?? { ...judged[0], judged: true, met: false, commitment: true };
  const list = [missedCommit, ...judged.filter((j) => j.targetId !== missedCommit.targetId)];
  it("are asked on the next End of day only: the last closed day must be the skipped one", () => {
    expect(owedFromLastClosed(null)).toBeNull();
    expect(owedFromLastClosed({ day: WED, status: "sent", judged: list, reasons: {} })).toBeNull();
    const owed = owedFromLastClosed({ day: WED, status: "skipped", judged: list, reasons: {} });
    expect(owed?.day).toBe(WED);
    expect(owed?.items.map((j) => j.targetId)).toContain(missedCommit.targetId);
  });
  it("a reason already given on the skipped day is not asked again", () => {
    expect(owedFromLastClosed({ day: WED, status: "skipped", judged: [missedCommit], reasons: { [missedCommit.targetId]: "Travel day" } })).toBeNull();
  });
});

describe("the strip, the figures, Past weeks, Most missed", () => {
  it("a per-weekday strip: Mon to Fri with today open, met count so far", () => {
    const s = stripOf(byName("Listings screened"), facts, FRI);
    expect(s.cells.map((c) => c.state)).toEqual(["met", "missed", "missed", "met", "now"]);
    expect(s.text).toBe("Mon to Fri · met 2 of 4 days so far");
    const judged = stripOf(byName("Listings screened"), facts, FRI, { judgedToday: true });
    expect(judged.cells[4].state).toBe("missed");
    expect(judged.text).toBe("Mon to Fri · met 2 of 5 days so far");
    const skipped = stripOf(byName("Listings screened"), facts, FRI, { skippedDays: ["2026-11-03"] });
    expect(skipped.cells[1].state).toBe("off");
    expect(skipped.text).toBe("Mon to Fri · met 2 of 3 days so far");
  });
  it("a per-week strip: the last 7 weeks plus this one, with the streak", () => {
    const s = stripOf(byName("Deals moved a stage"), facts, FRI);
    expect(s.cells).toHaveLength(8);
    // Edit batch C round 2: 3 moves of 2 this week, so this week's cell is met before Friday's End of day.
    expect(s.cells[7].state).toBe("met");
    expect(stripOf(byName("Network outreach"), facts, FRI).cells[7].state).toBe("now");
    expect(stripOf(byName("Network outreach"), facts, FRI, { judgedToday: true }).cells[7].state).toBe("missed");
    expect(s.cells[6].state).toBe("missed");
    expect(s.text).toBe("Last 8 weeks · met 0 of 7 · missed 7 in a row");
  });
  it("targetView: Today and This week for a weekday target, This week and Last week for a weekly one", () => {
    const v = targetView(byName("Listings screened"), facts, FRI);
    expect(v.figures.map((f) => `${f.label} ${f.value}`)).toEqual(["Today 3 of 5", "This week 19 of 25"]);
    expect(v.mark).toBe("now");
    const w = targetView(byName("Network outreach"), facts, FRI);
    expect(w.figures.map((f) => `${f.label} ${f.value} ${f.tone}`)).toEqual(["This week 5 of 10 plain", "Last week 1 of 10 missed"]);
    expect(targetView(byName("Network outreach"), facts, FRI, { judgedToday: true }).mark).toBe("missed");
    expect(targetView(byName("Deals moved a stage"), facts, FRI).mark).toBe("met");
  });
  it("counted days shrink on a skipped day; targets met this week", () => {
    expect(countedDays(FRI, [])).toBe(5);
    expect(countedDays(WED, [])).toBe(3);
    expect(countedDays(FRI, ["2026-11-03"])).toBe(4);
    expect(metThisWeek(targets, facts, FRI)).toMatchObject({ met: 1, total: 6, names: ["Deals moved a stage"] });
  });
  it("past weeks and Most missed", () => {
    const past = pastWeeks(targets, facts, FRI);
    expect(past).toHaveLength(4);
    expect(past[0].weekStart).toBe("2026-10-26");
    expect(past[0].met).toBe(3);
    expect(past[0].missed.map((m) => `${m.name} ${m.figure}`)).toEqual(["Brokers contacted 0 of 5", "Network outreach 1 of 10", "Deals moved a stage 1 of 2"]);
    expect(judgeWeek(targets, facts, "2026-10-26").missed.some((m) => m.name === "Rosara focus done")).toBe(false);
    expect(mostMissed(targets, facts, FRI)).toMatchObject({ name: "Brokers contacted", n: 7, of: 7 });
  });
});

describe("the Past weeks tile line", () => {
  it("uses the short names of the default targets and keeps a named one", () => {
    expect(missedLine({ weekStart: "2026-10-26", met: 3, total: 6, missed: [{ name: "Listings screened", figure: "12 of 25" }, { name: "Brokers contacted", figure: "3 of 5" }, { name: "Calls a day", figure: "4 of 10" }] })).toBe("Missed: Listings 12 of 25, Brokers 3 of 5, Calls a day 4 of 10");
    expect(missedLine({ weekStart: "2026-10-26", met: 6, total: 6, missed: [] })).toBe("Every target met");
  });
});

describe("the Home tile lines", () => {
  it("picks the commitments first, at most three, with the right words", () => {
    expect(tileTargets(targets).map((t) => t.name)).toEqual(["Listings screened", "Network outreach", "Brokers contacted"]);
    expect(tileTargetLine(byName("Listings screened"), 3, FRI)).toBe("Commitment · 2 to go before 5:30");
    expect(tileTargetLine(byName("Network outreach"), 4, FRI)).toBe("Commitment · judged tonight, it is Friday");
    expect(tileTargetLine(byName("Network outreach"), 4, WED)).toBe("Commitment · 6 to go this week");
    expect(tileTargetLine(byName("Deals moved a stage"), 3, WED)).toBe("met");
    expect(tileEodLine(2, "", "open", null, true)).toBe("Reasons (2 left), then approve and send");
    expect(tileEodLine(0, "", "open", null, false)).toBe("Tomorrow's line is empty; then approve and send");
    expect(tileEodLine(0, "x", "open", null, false)).toBe("Reasons done; approve and send");
    expect(tileEodLine(0, "x", "sent", null, true)).toBe("Approved by you. Next report Monday at 5:30.");
    expect(tileEodLine(1, "x", "skipped", "travel day", false)).toBe("Skipped: travel day. Any reason still owed is asked tomorrow.");
    expect(tomorrowLabel(FRI)).toBe("Monday");
    expect(tomorrowLabel(WED)).toBe("Tomorrow");
  });
});

describe("the report's numbers and the email", () => {
  const waits = [
    { name: "Summit Logistics Group", days: 11, who: "Mark Reed", what: "Seller call date", since: "2026-10-26" },
    { name: "Pinecrest Landscaping", days: 6, who: "Dana Whitfield", what: "The LOI answer", since: "2026-10-31" },
    { name: "Oakline Dental Lab", days: 2, who: "Luis Ortega", what: "The CIM", since: "2026-11-04" },
  ];
  const n = dayNumbers(facts, FRI, waits, 5);
  it("the Today tiles follow the targets (a bar only where a per-weekday target exists)", () => {
    const tiles = todayTiles(n, targets);
    expect(tiles.map((t) => `${t.label} ${t.value}${t.small ? ` ${t.small}` : ""} ${t.status}`)).toEqual(["Listings screened 3 of 5 missed", "Deals moved 1 neutral", "Next actions done 2 neutral", "Calls 2 neutral", "Emails 2 neutral", "Network outreach 3 missed"]);
    expect(tiles[5].note).toBe("5 of 10 this week");
    expect(n.waits.map((w) => w.name)).toEqual(["Summit Logistics Group", "Pinecrest Landscaping"]);
  });
  it("the week tiles and the deals bullets", () => {
    const w = weekNumbers(targets, facts, workWeekOf(FRI), waits);
    const last = weekNumbers(targets, facts, { start: "2026-10-26", end: "2026-10-30" }, waits);
    const tiles = weekTiles(w, last);
    expect(tiles.map((t) => `${t.label} ${t.value}${t.small ? ` ${t.small}` : ""}`)).toEqual(["Targets met 1 of 6", "Deals moved 3", "Listings screened 19", "Network outreach 5 of 10", "Follow-ups on time 67%", "Days waiting on brokers 6.3"]);
    expect(tiles[0].note).toBe("Missed: Listings, Brokers and 3 more");
    expect(tiles[1].note).toBe("Dalton, Meridian and 1 more");
    expect(tiles[5].note).toBe("3 open waits · Summit 11 days");
    expect(dealBullets(n.moves, n.waits, 5)).toEqual(["Dalton Services moved to Seller call. Key finding: 70% of revenue is recurring maintenance contracts.", "Waiting on brokers over 5 days: Summit Logistics Group (11 days, Mark Reed), Pinecrest Landscaping (6 days, Dana Whitfield)."]);
  });
  it("the pill, the target lines, and the summary", () => {
    const fri = judgeDay(targets, facts, FRI);
    expect(pillOf(fri, true)).toEqual({ text: "1 of 6 targets met", status: "missed" });
    const wed = judgeDay(targets, facts, WED);
    expect(pillOf(wed, false)).toEqual({ text: "Listings screened missed", status: "missed" });
    expect(targetLine(fri[0], 19)).toBe("Listings screened 3 of 5 today, 19 of 25 this week");
    // Mid-week the week's number is the days counted so far (as on Targets): Wednesday, 3 days.
    expect(targetLine(fri[0], 11, countedDays(WED, []))).toBe("Listings screened 3 of 5 today, 11 of 15 this week");
    expect(targetLine(fri.find((j) => j.name === "Rosara focus done")!, null)).toBe("Rosara focus done not yet");
    expect(reportSummary(fri, n, true)).toBe("1 of 6 targets met · Dalton to Seller call · Priya Natarajan and Carla Jenkins contacted · the week added");
    expect(reportSummary(wed, dayNumbers(facts, WED, waits, 5), false)).toBe("Listings screened 4 of 5 · Meridian to Model");
  });
  it("the email: the layout the app sends, the reasons as written, the short version, the text part", () => {
    const d: ReportData = {
      partnerName: "Jake Morgan", partnerFirst: "Jake", dateLong: "Friday, Nov 6, 2026", dateShort: "Friday, Nov 6", withWeek: true,
      pill: { text: "1 of 6 targets met", status: "missed" },
      today: todayTiles(n, targets),
      deals: dealBullets(n.moves, n.waits, 5),
      targets: [{ met: false, judged: true, line: "Listings screened 3 of 5 today, 19 of 25 this week", commitment: true, reason: "Deal work filled the block" }, { met: true, judged: true, line: "Deals moved a stage 3 of 2", commitment: false, reason: null }, { met: false, judged: true, line: "Network outreach 5 of 10", commitment: true, reason: null }],
      owed: ["Wednesday, Listings screened 2 of 5: travel day"],
      week: { label: "The week, Nov 2 to 6", tiles: weekTiles(weekNumbers(targets, facts, workWeekOf(FRI), waits), null) },
      tomorrow: { label: "Monday", text: "Monday: finish the Meridian model before 10" },
    };
    const html = reportInnerHtml(d);
    expect(html).toContain("Daily report, with the week");
    expect(html).toContain("Hello Jake,");
    expect(html).toContain("It is Friday, so the week is at the end.");
    expect(html).toContain("Commitment. Deal work filled the block");
    expect(html).toContain("Commitment. (reason still to give)");
    expect(html).toContain("Owed</span>&nbsp; Wednesday, Listings screened 2 of 5: travel day");
    expect(html).toContain("Nothing is required from you. Reply to this email if you want to talk.");
    expect(html).toContain("Thank you,<br>Bram");
    expect(html).toContain("The week, Nov 2 to 6");
    expect(html).not.toMatch(/<script|<style|<img/i);
    expect(html).not.toMatch(/#b8862b|#7a5714|#fbf4e2/i);
    const short = reportInnerHtml(d, true);
    expect(short).toContain("short version");
    expect(short).not.toContain(">Today<");
    expect(short).not.toContain(">Deals<");
    expect(short).toContain(">Targets<");
    expect(reportSubject(d)).toBe("Daily report with the week: Friday, Nov 6, 2026");
    const text = reportText(d);
    expect(text).toContain("TODAY\n- Listings screened: 3 of 5 (2 passed (Too small, Retail), 1 Interested: Industrial Filtration Distributor)");
    expect(text).toContain("- Missed: Listings screened 3 of 5 today, 19 of 25 this week Commitment. Deal work filled the block");
    expect(text).toContain("MONDAY\nMonday: finish the Meridian model before 10");
    expect(text).toMatch(/Thank you,\nBram$/);
  });
});

describe("the AI reasons reply", () => {
  const asked = judgeDay(targets, facts, FRI).filter((j) => j.judged && !j.met && j.commitment);
  it("matches by id, by name, or in order; drops empty lines and extras", () => {
    const r = validateReasonsReply({ reasons: [{ target_id: "t3", reason: "Deal work filled Wednesday to Friday" }, { name: "Listings screened", reason: " The CIM review took the block. " }, { reason: "extra" }] }, asked);
    expect(r.ok && r.value).toEqual([{ targetId: "t3", name: "Network outreach", reason: "Deal work filled Wednesday to Friday" }, { targetId: "t1", name: "Listings screened", reason: "The CIM review took the block." }]);
    const plain = validateReasonsReply({ items: ["First line", "Second line"] }, asked);
    expect(plain.ok && plain.value.map((d) => d.targetId)).toEqual(["t1", "t3"]);
    expect(validateReasonsReply({ reasons: [] }, asked).ok).toBe(false);
    expect(validateReasonsReply("no", asked).ok).toBe(false);
  });
});

describe("Edit batch C: the target pill, what a target counts, exceeded reads met, the Today strip", () => {
  it("the pill carries the number and the cadence; the line under the name says only what it counts", () => {
    expect(targets.map(targetPill)).toEqual(["5 / weekday", "5 / week", "10 / week", "100% on time", "2 / week", "1 / week"]);
    expect(countsLine(byName("Listings screened"))).toBe("Counts Pass or Interested on Screen listings");
    const v = targetView(byName("Listings screened"), facts, FRI);
    expect(v.pill).toBe("5 / weekday");
    expect(v.line).toBe("Counts Pass or Interested on Screen listings");
    expect(v.line).not.toMatch(/target|Per week/);
  });
  it("a figure over its target is met (14 of 10 is right, not capped)", () => {
    const busy: Facts = { ...facts, comms: Array.from({ length: 14 }, (_, i) => ({ on: "2026-11-03", method: "email", contactId: `x${i}`, contactName: `X ${i}`, broker: false })) };
    const w = targetView(byName("Network outreach"), busy, FRI);
    expect(w.figures[0]).toMatchObject({ value: "14 of 10", tone: "met" });
    expect(w.mark).toBe("met");
  });
  it("the Today strip: six figures in order with their words, each with the items behind it", () => {
    const n = dayNumbers(facts, FRI, [{ name: "Summit Logistics Group", days: 11, who: "Mark Reed", what: "A seller call", since: "Oct 26" }, { name: "Oakline Dental Lab", days: 2, who: null, what: "The CIM", since: null }], 5);
    expect(todayStrip(n, 5).map((p) => `${p.value} ${p.words}`)).toEqual(["3 screened", "1 moved", "2 calls", "2 emails", "2 next actions done", "1 waiting over 5 days"]);
    expect(n.screenedList.map((x) => `${x.name} ${x.outcome} ${x.reason ?? ""}`.trim())).toEqual(["Fri 1 passed Too small", "Fri 2 passed Retail", "Industrial Filtration Distributor interested"]);
    expect(n.contactsList.filter((c) => c.kind === "call").map((c) => c.name)).toEqual(["Priya Natarajan", "Carla Jenkins"]);
    expect(n.contactsList.filter((c) => c.kind === "email").map((c) => c.name)).toEqual(["Tom Baker", "Someone not on Outreach"]);
    expect(n.actionsDoneList).toEqual([{ name: "Meridian Industrial Coatings", label: "Finish the model" }, { name: "Dalton Services", label: "Call Carla" }]);
    const one = dayNumbers({ ...EMPTY_FACTS, comms: [{ on: FRI, method: "call", contactId: "p1", contactName: "A", broker: false }] }, FRI, [], 5);
    expect(todayStrip(one, 5).find((p) => p.key === "calls")!.words).toBe("call");
  });
});

describe("Edit batch C round 2: a weekly target is Met as soon as it is reached", () => {
  it("judgedMark: met when reached (even midweek), missed only once judged below, under way otherwise", () => {
    expect(judgedMark({ met: true, judged: false })).toBe("met");
    expect(judgedMark({ met: true, judged: true })).toBe("met");
    expect(judgedMark({ met: false, judged: false })).toBe("now");
    expect(judgedMark({ met: false, judged: true })).toBe("missed");
    expect(MARK_WORD[judgedMark({ met: true, judged: false })]).toBe("Met");
  });
  it("on a Wednesday End of day a per-week target already reached reads Met; one below reads Under way", () => {
    const wed = judgeDay(targets, facts, WED);
    const moved = wed.find((j) => j.name === "Deals moved a stage")!;
    // The week counts every move of the week (the fixture also holds Friday's): over its target before Friday.
    expect(moved).toMatchObject({ judged: false, met: true, figure: "3 of 2" });
    expect(judgedMark(moved)).toBe("met");
    const outreach = wed.find((j) => j.name === "Network outreach")!;
    expect(judgedMark(outreach)).toBe("now");
    const fri = judgeDay(targets, facts, FRI);
    expect(judgedMark(fri.find((j) => j.name === "Network outreach")!)).toBe("missed");
  });
  it("the report preview's target lines say Met for a weekly target reached midweek", () => {
    const wed = judgeDay(targets, facts, WED);
    const data: ReportData = {
      partnerName: "Jake Morgan", partnerFirst: "Jake", dateLong: "Wednesday, Nov 4, 2026", dateShort: "Wednesday, Nov 4", withWeek: false,
      pill: { text: "x", status: "neutral" }, today: [], deals: [], owed: [], week: null, tomorrow: { label: "Tomorrow", text: null },
      targets: wed.map((j) => ({ met: j.met, judged: j.judged, line: targetLine(j, null), commitment: j.commitment, reason: null })),
    };
    const text = reportText(data);
    expect(text).toContain("- Met: Deals moved a stage 3 of 2");
    expect(text).toMatch(/- Under way: Network outreach/);
    expect(reportInnerHtml(data)).toContain("Met</span>&nbsp; Deals moved a stage 3 of 2");
  });
  it("the Targets row: the mark is Met midweek once the week's count reaches the target", () => {
    expect(targetView(byName("Deals moved a stage"), facts, WED).mark).toBe("met");
    expect(targetView(byName("Network outreach"), facts, WED).mark).toBe("now");
  });
});

describe("Edit batch C round 2: Reports regrouped", () => {
  const week = workWeekOf(FRI);
  it("Most missed this week: the target furthest below its target; none when all are met", () => {
    const m = mostMissedIn(targets, facts, week, FRI);
    expect(m).not.toBeNull();
    expect(m!.share).toBeLessThan(1);
    // Rosara focus done (0 of 1) is the furthest behind.
    expect(m!.name).toBe("Rosara focus done");
    expect(mostMissedIn([byName("Deals moved a stage")], facts, week, FRI)).toBeNull();
  });
  it("Most missed over a month: the target missed in most judged weeks", () => {
    const m = mostMissedIn(targets, facts, { start: "2026-11-01", end: FRI }, "2026-11-30", [], true);
    expect(m?.weeks?.of).toBeGreaterThan(0);
    expect(m?.figure).toMatch(/ of \d+ weeks$/);
  });
  it("six tiles: no Targets met, Most missed last, nothing that the cards list (no names in the notes)", () => {
    const w = weekNumbers(targets, facts, week, [{ name: "Dalton Services", who: "Carla", what: "the CIM", since: "Oct 30", days: 6 }], [], FRI);
    const last = weekNumbers(targets, facts, { start: "2026-10-26", end: "2026-10-30" }, [], []);
    const tiles = reportTiles(w, last, mostMissedIn(targets, facts, week, FRI), { label: "Most missed this week", open: true });
    expect(tiles.map((t) => t.label)).toEqual(["Deals moved", "Listings screened", "Network outreach", "Follow-ups on time", "Days waiting on brokers", "Most missed this week"]);
    expect(tiles.find((t) => t.label === "Deals moved")!.note).toBe("Last week 1");
    expect(tiles.some((t) => /Dalton|Meridian|BrightPath|Mark Reed|Priya/.test(t.note))).toBe(false);
    expect(tiles.find((t) => t.label === "Follow-ups on time")!.note).toBe("2 of 3 on time");
    expect(tiles[5]).toMatchObject({ value: "Rosara focus", note: "Furthest behind so far", status: "neutral" });
    // While the week is open nothing reads as missed.
    expect(tiles.some((t) => t.status === "missed")).toBe(false);
    const closed = reportTiles(w, last, null, { label: "Most missed last week", open: false });
    expect(closed[5]).toMatchObject({ value: "None", note: "Every target met", status: "met" });
  });
});
