/**
 * Targets, End of day, and Reports (batch C, approved 2026-10-31), pure and tested in
 * src/lib/accountability/targets.test.ts: what a target can count, the six defaults, the counting of every target from
 * the app's own facts (listings screened, stage moves, emails and calls, follow-ups done, next actions done, the
 * Rosara focus done), the judging (a per-weekday target is judged daily, a per-week one on Friday), the status mark
 * (met, missed, under way), the cell strip (Mon to Fri, or the last 8 weeks) with its met count and streak, the Past
 * weeks tiles and "Most missed", the reasons-left logic of End of day, the report's numbers, and the Home tile lines.
 * Nothing here reads the database: src/lib/accountability/data.ts loads the facts and calls these.
 */
import { addDaysISO, isWeekday, weekBounds } from "@/lib/calc/dates";
import { weekdayShort } from "@/lib/work/outreach";

// ---------- What a target counts ----------

type CountKey = "listings_screened" | "passes" | "brokers_contacted" | "emails_sent" | "calls_logged" | "outreach_contacts" | "follow_ups_on_time" | "deals_moved" | "next_actions_done" | "rosara_focus_done";

type Countable = { key: CountKey; label: string; /** "counts ..." on the target row. */ counts: string; unit: "count" | "percent" | "yesno" };

/** The countable things, in the order of the "Counts" choice on Add a target. */
export const COUNTABLES: readonly Countable[] = [
  { key: "listings_screened", label: "Listings screened", counts: "Pass or Interested on Screen listings", unit: "count" },
  { key: "passes", label: "Passes", counts: "Pass on Screen listings", unit: "count" },
  { key: "brokers_contacted", label: "Brokers contacted", counts: "emails sent and calls logged to people with the role Broker, each person once", unit: "count" },
  { key: "emails_sent", label: "Emails sent", counts: "emails sent from the app or logged on a person", unit: "count" },
  { key: "calls_logged", label: "Calls logged", counts: "calls, meetings, and video calls logged", unit: "count" },
  { key: "outreach_contacts", label: "Outreach contacts", counts: "emails sent and calls logged to people, Mon to Fri", unit: "count" },
  { key: "follow_ups_on_time", label: "Follow-ups on time", counts: "outreach follow-ups done on or before their date", unit: "percent" },
  { key: "deals_moved", label: "Deals moved", counts: "stage moves on Deals, Job search and Consulting", unit: "count" },
  { key: "next_actions_done", label: "Next actions done", counts: "next actions marked Done on deals, projects, and opportunities, and tasks checked off on records", unit: "count" },
  { key: "rosara_focus_done", label: "Rosara focus done", counts: "the weekly focus marked done on Rosara", unit: "yesno" },
];

const COUNT_KEYS = COUNTABLES.map((c) => c.key) as readonly CountKey[];
export const isCountKey = (v: unknown): v is CountKey => (COUNT_KEYS as readonly string[]).includes(String(v));
export const countable = (key: CountKey): Countable => COUNTABLES.find((c) => c.key === key) ?? COUNTABLES[0];

export type Cadence = "day" | "week";

/** One target as the screens show it (plain data). */
export type Target = { id: string; name: string; key: CountKey; cadence: Cadence; number: number; commitment: boolean; sortOrder: number };

/** The six default targets, seeded when the owner has none (the same list as seed_owner_batch_c in update 0025). */
export const DEFAULT_TARGETS: readonly Omit<Target, "id">[] = [
  { name: "Listings screened", key: "listings_screened", cadence: "day", number: 5, commitment: true, sortOrder: 1 },
  { name: "Brokers contacted", key: "brokers_contacted", cadence: "week", number: 5, commitment: false, sortOrder: 2 },
  { name: "Network outreach", key: "outreach_contacts", cadence: "week", number: 10, commitment: true, sortOrder: 3 },
  { name: "Follow-ups done on time", key: "follow_ups_on_time", cadence: "week", number: 100, commitment: false, sortOrder: 4 },
  { name: "Deals moved a stage", key: "deals_moved", cadence: "week", number: 2, commitment: false, sortOrder: 5 },
  { name: "Rosara focus done", key: "rosara_focus_done", cadence: "week", number: 1, commitment: false, sortOrder: 6 },
];

/**
 * The target pill after a target's name (Edit batch C, item 5): "5 / weekday", "10 / week", "100% on time", "1 / week".
 * A percent target is on time by what it counts; every other target is a number per weekday or per week.
 */
function targetPill(t: Pick<Target, "key" | "cadence" | "number">): string {
  if (countable(t.key).unit === "percent") return `${t.number}% on time`;
  return `${t.number} / ${t.cadence === "day" ? "weekday" : "week"}`;
}

/** The line under a target's name once the pill carries the number: only what it counts ("Counts Pass or Interested on Screen listings"). */
function countsLine(t: Pick<Target, "key">): string {
  return `Counts ${countable(t.key).counts}`;
}

// ---------- The facts the app counts from ----------

export type Facts = {
  /** A listing screened: the day it first got a stage, Passed or Interested. */
  screened: { on: string; outcome: "passed" | "interested"; name: string; reason: string | null }[];
  /** A stage move of a deal, an opportunity, or a consulting item (from one working stage to the next). */
  moves: { on: string; name: string; from: string | null; to: string; keyFinding: string | null; lane: "Deals" | "Job search" | "Consulting" }[];
  /** An outgoing email, call, meeting, or video call with a person. */
  comms: { on: string; method: string; contactId: string | null; contactName: string | null; broker: boolean }[];
  /** A follow-up marked Done, with whether it was on or before its date. */
  followUps: { on: string; onTime: boolean; name: string }[];
  /** A next action marked Done, or (push E2) a task on a record checked off, with the record's area. */
  actionsDone: { on: string; name: string; label: string; area: DoneArea }[];
  /** The Rosara weekly focus marked done. */
  focusDone: { on: string; text: string }[];
  /** Push E2: a personal to-do (no record) checked off. */
  todosDone: { on: string; text: string }[];
};

/** The areas next actions are done in, named as on the Area selector (src/lib/work/lanes.ts AREAS), in its order. */
export const DONE_AREAS = ["Deals", "Contacts", "Rosara", "Job search", "Consulting"] as const;
export type DoneArea = (typeof DONE_AREAS)[number];

export const EMPTY_FACTS: Facts = { screened: [], moves: [], comms: [], followUps: [], actionsDone: [], focusDone: [], todosDone: [] };

const inRange = (on: string, start: string, end: string) => on >= start && on <= end;
const isCall = (m: string) => m === "call" || m === "meeting" || m === "video";
const isContact = (m: string) => m === "email" || isCall(m);

/** A count for one key over a period: the value the target is judged on, plus what makes it up. */
type Count = { value: number; /** "2 passed, 1 Interested", "12 of 14", "Dalton, Meridian". */ detail: string; names: string[]; /** For percent keys: how many were done and how many on time. */ parts?: { done: number; onTime: number } };

/** Counts one key between two dates (inclusive, YYYY-MM-DD). */
export function countIn(key: CountKey, f: Facts, start: string, end: string): Count {
  switch (key) {
    case "listings_screened": {
      const rows = f.screened.filter((x) => inRange(x.on, start, end));
      const passed = rows.filter((x) => x.outcome === "passed");
      const interested = rows.filter((x) => x.outcome === "interested");
      const parts: string[] = [];
      if (passed.length) parts.push(`${passed.length} passed${passed.length <= 3 && passed.some((p) => p.reason) ? ` (${[...new Set(passed.map((p) => p.reason).filter(Boolean))].join(", ")})` : ""}`);
      if (interested.length) parts.push(`${interested.length} Interested${interested.length <= 2 ? `: ${interested.map((i) => i.name).join(", ")}` : ""}`);
      return { value: rows.length, detail: parts.join(", "), names: rows.map((r) => r.name) };
    }
    case "passes": {
      const rows = f.screened.filter((x) => x.outcome === "passed" && inRange(x.on, start, end));
      return { value: rows.length, detail: rows.length ? listNames(rows.map((r) => r.name)) : "", names: rows.map((r) => r.name) };
    }
    case "brokers_contacted": {
      const rows = f.comms.filter((c) => c.broker && !!c.contactId && isContact(c.method) && inRange(c.on, start, end));
      const names = [...new Map(rows.map((r) => [r.contactId!, r.contactName ?? "a broker"])).values()];
      return { value: names.length, detail: listNames(names), names };
    }
    case "emails_sent": {
      const rows = f.comms.filter((c) => c.method === "email" && inRange(c.on, start, end));
      const brokers = rows.filter((r) => r.broker).length;
      return { value: rows.length, detail: brokers ? `${brokers} to ${brokers === 1 ? "a broker" : "brokers"}` : "", names: rows.map((r) => r.contactName ?? "").filter(Boolean) };
    }
    case "calls_logged": {
      const rows = f.comms.filter((c) => isCall(c.method) && inRange(c.on, start, end));
      const names = [...new Set(rows.map((r) => r.contactName ?? "").filter(Boolean))];
      return { value: rows.length, detail: listNames(names), names };
    }
    case "outreach_contacts": {
      const rows = f.comms.filter((c) => !!c.contactId && isContact(c.method) && inRange(c.on, start, end) && isWeekday(c.on));
      const names = [...new Set(rows.map((r) => r.contactName ?? "").filter(Boolean))];
      return { value: rows.length, detail: listNames(names), names };
    }
    case "follow_ups_on_time": {
      const rows = f.followUps.filter((x) => inRange(x.on, start, end));
      const onTime = rows.filter((x) => x.onTime).length;
      const value = rows.length ? Math.round((onTime / rows.length) * 100) : 100;
      const late = rows.filter((x) => !x.onTime).map((x) => x.name);
      return { value, detail: rows.length ? `${onTime} of ${rows.length}${late.length ? ` · ${late.length === 1 ? "one late" : `${late.length} late`}: ${listNames(late)}` : ""}` : "none due", names: late, parts: { done: rows.length, onTime } };
    }
    case "deals_moved": {
      const rows = f.moves.filter((x) => inRange(x.on, start, end));
      const names = [...new Set(rows.map((r) => shortName(r.name)))];
      return { value: rows.length, detail: listNames(names), names: rows.map((r) => r.name) };
    }
    case "next_actions_done": {
      const rows = f.actionsDone.filter((x) => inRange(x.on, start, end));
      return { value: rows.length, detail: listNames([...new Set(rows.map((r) => r.name))]), names: rows.map((r) => r.name) };
    }
    case "rosara_focus_done": {
      const rows = f.focusDone.filter((x) => inRange(x.on, start, end));
      const last = rows[rows.length - 1];
      return { value: rows.length ? 1 : 0, detail: last ? `${last.text ? `${last.text}, ` : ""}done ${dayName(last.on)}` : "", names: rows.map((r) => r.text) };
    }
  }
}

/** "Dalton, Meridian" or "Dalton, Meridian and 4 more": at most two names on a target's line (2026-11-05), then the count. */
export function listNames(names: readonly string[], max = 2): string {
  const list = names.filter(Boolean);
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} and ${list.length - max} more`;
}

/** The first word or two of a company name ("Dalton Services" to "Dalton", "Meridian Industrial Coatings" to "Meridian"). */
export function shortName(name: string): string {
  const w = name.replace(/^00 /, "").split(/\s+/);
  return w.length >= 2 && /^[A-Za-z][A-Za-z'-]{3,}$/.test(w[0]) ? w[0] : name;
}

const DAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
function dayName(date: string): string {
  return DAY_NAMES[weekdayShort(date)] ?? date;
}

// ---------- Periods, judging, the status mark ----------

type Period = { start: string; end: string };

/** Monday to Friday of the week that holds the date. */
export function workWeekOf(date: string): Period {
  const { start } = weekBounds(date);
  return { start, end: addDaysISO(start, 4) };
}

/** The period a target is judged on for a date: that day, or Monday to Friday of its week. */
function periodOf(t: Pick<Target, "cadence">, date: string): Period {
  return t.cadence === "day" ? { start: date, end: date } : workWeekOf(date);
}

function isMet(t: Pick<Target, "number">, value: number): boolean {
  return value >= t.number;
}

/** "3 of 5", "86%", "Done" or "Not yet". */
export function figure(t: Pick<Target, "key" | "number">, value: number, required = t.number): string {
  const unit = countable(t.key).unit;
  if (unit === "yesno") return value >= 1 ? "Done" : "Not yet";
  if (unit === "percent") return `${value}%`;
  return `${value} of ${required}`;
}

/** Does End of day judge this target on this date? Per weekday: every weekday. Per week: Friday. */
function judgedOn(t: Pick<Target, "cadence">, date: string): boolean {
  return t.cadence === "day" ? isWeekday(date) : weekdayShort(date) === "Fri";
}

export type Mark = "met" | "missed" | "now";

/**
 * The status mark: met when the figure reaches the target; missed when the period ended (or End of day judged it)
 * unmet; under way (now) while the day or week is not finished.
 */
function markOf(t: Pick<Target, "number">, value: number, periodEnd: string, today: string, judged = false): Mark {
  if (isMet(t, value)) return "met";
  return periodEnd < today || judged ? "missed" : "now";
}

export const MARK_WORD: Record<Mark, string> = { met: "Met", missed: "Missed", now: "Under way" };

/**
 * The mark of a judged line (End of day, its report preview and email, Reports; Edit batch C round 2, item 7): Met as
 * soon as the count reaches the target, even midweek for a per-week target; Missed only once it is judged (a weekday's
 * End of day, Friday's for a per-week target) below target; Under way otherwise.
 */
export function judgedMark(j: { met: boolean; judged: boolean }): Mark {
  return j.met ? "met" : j.judged ? "missed" : "now";
}

// ---------- The cell strip and the streak ----------

export type Cell = { state: "met" | "missed" | "now" | "off" | "future"; title: string; period: Period };

export type Strip = { cells: Cell[]; /** "Mon to Fri · met 2 of 4 days so far", "Last 8 weeks · met 5 of 7 · met 3 in a row". */ text: string; met: number; judged: number; streak: { kind: "met" | "missed"; n: number } | null };

/**
 * The strip of small cells under a target: Mon to Fri of this week for a per-weekday target (today is "now" until End
 * of day judged it, a skipped day is "off", a day to come is empty), or the last 7 weeks plus this one for a per-week
 * target. `judgedToday` is true once today's End of day was sent or skipped.
 */
function stripOf(t: Target, f: Facts, today: string, opts: { skippedDays?: readonly string[]; judgedToday?: boolean } = {}): Strip {
  const skipped = new Set(opts.skippedDays ?? []);
  const cells: Cell[] = [];
  let met = 0;
  let judged = 0;
  if (t.cadence === "day") {
    const week = workWeekOf(today);
    for (let i = 0; i < 5; i++) {
      const d = addDaysISO(week.start, i);
      const name = weekdayShort(d);
      const v = countIn(t.key, f, d, d).value;
      if (d > today) cells.push({ state: "future", title: `${name}: to come`, period: { start: d, end: d } });
      else if (skipped.has(d)) cells.push({ state: "off", title: `${name}: not counted (skipped)`, period: { start: d, end: d } });
      else if (d === today && !opts.judgedToday) cells.push({ state: "now", title: `${name} so far: ${figure(t, v)}`, period: { start: d, end: d } });
      else {
        judged++;
        const m = isMet(t, v);
        if (m) met++;
        cells.push({ state: m ? "met" : "missed", title: `${name}: ${figure(t, v)}`, period: { start: d, end: d } });
      }
    }
    const text = `Mon to Fri · met ${met} of ${judged} ${judged === 1 ? "day" : "days"}${today <= week.end ? " so far" : ""}`;
    return { cells, text, met, judged, streak: null };
  }
  const thisWeek = workWeekOf(today);
  const results: boolean[] = [];
  for (let i = 7; i >= 1; i--) {
    const start = addDaysISO(thisWeek.start, -7 * i);
    const p = { start, end: addDaysISO(start, 4) };
    const v = countIn(t.key, f, p.start, p.end).value;
    const m = isMet(t, v);
    results.push(m);
    if (m) met++;
    judged++;
    cells.push({ state: m ? "met" : "missed", title: `Week of ${p.start}: ${figure(t, v)}`, period: p });
  }
  const v = countIn(t.key, f, thisWeek.start, thisWeek.end).value;
  // Met as soon as the week's count reaches the target (Edit batch C round 2); missed only after Friday's End of day.
  cells.push({ state: isMet(t, v) ? "met" : (opts.judgedToday && weekdayShort(today) === "Fri") || today > thisWeek.end ? "missed" : "now", title: `This week so far: ${figure(t, v)}`, period: thisWeek });
  let run = 0;
  for (let i = results.length - 1; i >= 0 && results[i]; i--) run++;
  let miss = 0;
  for (let i = results.length - 1; i >= 0 && !results[i]; i--) miss++;
  const streak = run >= 2 ? { kind: "met" as const, n: run } : miss >= 2 ? { kind: "missed" as const, n: miss } : null;
  const text = `Last 8 weeks · met ${met} of 7${streak ? ` · ${streak.kind} ${streak.n} in a row` : ""}`;
  return { cells, text, met, judged, streak };
}

// ---------- The target rows (Targets page) ----------

type Fig = { value: string; label: string; tone: "plain" | "met" | "missed" | "none" };

export type TargetView = Target & {
  /** What the target counts (the pill carries the number and the cadence). */
  line: string;
  /** "5 / weekday", "10 / week", "100% on time". */
  pill: string;
  strip: Strip;
  mark: Mark;
  /** Today and This week (per weekday), or This week and Last week (per week). */
  figures: [Fig, Fig];
  /** The figure the mark is about. */
  value: number;
};

export function targetView(t: Target, f: Facts, today: string, opts: { skippedDays?: readonly string[]; judgedToday?: boolean } = {}): TargetView {
  const strip = stripOf(t, f, today, opts);
  const week = workWeekOf(today);
  if (t.cadence === "day") {
    const todayCount = countIn(t.key, f, today, today).value;
    const weekSum = countIn(t.key, f, week.start, week.end).value;
    const counted = countedDays(today, opts.skippedDays ?? []);
    const required = t.number * counted;
    const mark = markOf(t, todayCount, today, today, opts.judgedToday);
    return {
      ...t,
      line: countsLine(t),
      pill: targetPill(t),
      strip,
      mark: isWeekday(today) ? mark : markOf(t, weekSum, week.end, today),
      figures: [
        { value: figure(t, todayCount), label: "Today", tone: isMet(t, todayCount) ? "met" : mark === "missed" ? "missed" : "plain" },
        { value: `${weekSum} of ${required}`, label: "This week", tone: weekSum >= required && counted > 0 ? "met" : "plain" },
      ],
      value: todayCount,
    };
  }
  const cur = countIn(t.key, f, week.start, week.end);
  const lastWeek = { start: addDaysISO(week.start, -7), end: addDaysISO(week.start, -3) };
  const last = countIn(t.key, f, lastWeek.start, lastWeek.end);
  const mark = markOf(t, cur.value, week.end, today, opts.judgedToday && weekdayShort(today) === "Fri");
  return {
    ...t,
    line: countsLine(t),
    pill: targetPill(t),
    strip,
    mark,
    figures: [
      { value: figure(t, cur.value), label: "This week", tone: isMet(t, cur.value) ? "met" : mark === "missed" ? "missed" : countable(t.key).unit === "yesno" ? "none" : "plain" },
      { value: figure(t, last.value), label: "Last week", tone: isMet(t, last.value) ? "met" : "missed" },
    ],
    value: cur.value,
  };
}

/** The weekdays of this week up to and including today, less the skipped ones (the "of 25" of a per-weekday target shrinks on a travel day). */
export function countedDays(today: string, skipped: readonly string[]): number {
  const week = workWeekOf(today);
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const d = addDaysISO(week.start, i);
    if (d <= today && !skipped.includes(d)) n++;
  }
  // Before the week's Monday (a weekend) the whole week counts.
  return today < week.start ? 5 : n;
}

/** Targets met this week so far, of N: a per-week target by its week figure, a per-weekday one by its week sum. */
export function metThisWeek(targets: readonly Target[], f: Facts, today: string, skipped: readonly string[] = []): { met: number; total: number; names: string[] } {
  const week = workWeekOf(today);
  const names: string[] = [];
  for (const t of targets) {
    const v = countIn(t.key, f, week.start, week.end).value;
    const required = t.cadence === "day" ? t.number * countedDays(today, skipped) : t.number;
    if (v >= required && (t.cadence !== "day" || required > 0)) names.push(t.name);
  }
  return { met: names.length, total: targets.length, names };
}

// ---------- Past weeks and Most missed ----------

export type WeekTile = { weekStart: string; met: number; total: number; missed: { name: string; figure: string }[] };

/** A week's judgment of every target (a per-weekday target: its sum against number times 5 counted days). */
export function judgeWeek(targets: readonly Target[], f: Facts, weekStart: string, skipped: readonly string[] = []): WeekTile {
  const end = addDaysISO(weekStart, 4);
  const days = 5 - skipped.filter((d) => d >= weekStart && d <= end).length;
  const missed: { name: string; figure: string }[] = [];
  let met = 0;
  for (const t of targets) {
    const v = countIn(t.key, f, weekStart, end).value;
    const required = t.cadence === "day" ? t.number * days : t.number;
    if (v >= required) met++;
    else missed.push({ name: t.name, figure: t.cadence === "day" ? `${v} of ${required}` : countable(t.key).unit === "yesno" ? "not done" : figure(t, v) });
  }
  return { weekStart, met, total: targets.length, missed };
}

const SHORT_NAMES: Record<string, string> = { "Listings screened": "Listings", "Brokers contacted": "Brokers", "Network outreach": "Outreach", "Follow-ups done on time": "Follow-ups", "Deals moved a stage": "Deals moved", "Rosara focus done": "Rosara focus" };

/** The short name of a default target for the Past weeks tiles ("Listings 12 of 25"); a target Bram named keeps its name. */
export function shortTargetName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}

/** The last four full weeks before this one, newest first. */
export function pastWeeks(targets: readonly Target[], f: Facts, today: string, skipped: readonly string[] = [], n = 4): WeekTile[] {
  const thisWeek = workWeekOf(today);
  const out: WeekTile[] = [];
  for (let i = 1; i <= n; i++) out.push(judgeWeek(targets, f, addDaysISO(thisWeek.start, -7 * i), skipped));
  return out;
}

/** "Network outreach, 5 of the last 7 weeks": the target missed in most of the last 7 weeks, or null when every week was met. */
export function mostMissed(targets: readonly Target[], f: Facts, today: string, skipped: readonly string[] = [], weeks = 7): { name: string; n: number; of: number } | null {
  const thisWeek = workWeekOf(today);
  const misses = new Map<string, number>();
  for (let i = 1; i <= weeks; i++) {
    const w = judgeWeek(targets, f, addDaysISO(thisWeek.start, -7 * i), skipped);
    for (const m of w.missed) misses.set(m.name, (misses.get(m.name) ?? 0) + 1);
  }
  let best: { name: string; n: number; of: number } | null = null;
  for (const t of targets) {
    const n = misses.get(t.name) ?? 0;
    if (n > 0 && (!best || n > best.n)) best = { name: t.name, n, of: weeks };
  }
  return best;
}

// ---------- End of day: the judged targets and the reasons ----------

export type Judged = { targetId: string; name: string; key: CountKey; cadence: Cadence; number: number; commitment: boolean; value: number; met: boolean; /** "3 of 5", "86%". */ figure: string; /** "Per weekday · target 5 · this week 19 of 25". */ line: string; /** "2 passed, 1 Interested". */ detail: string; /** Judged on this End of day (a per-week target on Monday to Thursday is not). */ judged: boolean };

export function judgeDay(targets: readonly Target[], f: Facts, day: string, skipped: readonly string[] = []): Judged[] {
  const week = workWeekOf(day);
  return targets.map((t) => {
    const p = periodOf(t, day);
    const c = countIn(t.key, f, p.start, p.end);
    const met = isMet(t, c.value);
    let line: string;
    if (t.cadence === "day") {
      // The week so far, up to the day being judged.
      const sum = countIn(t.key, f, week.start, day).value;
      line = `Per weekday · target ${t.number} · this week ${sum} of ${t.number * countedDays(day, skipped)}`;
    } else line = `Per week · target ${countable(t.key).unit === "percent" ? `${t.number}%` : t.number}${c.detail ? ` · ${c.detail}` : ""}`;
    return { targetId: t.id, name: t.name, key: t.key, cadence: t.cadence, number: t.number, commitment: t.commitment, value: c.value, met, figure: figure(t, c.value), line, detail: c.detail, judged: judgedOn(t, day) };
  });
}

/** The judged targets that ask for a reason: missed Commitments that End of day judges today. */
export function askedForReason(judged: readonly Judged[]): Judged[] {
  return judged.filter((j) => j.judged && !j.met && j.commitment);
}

/** The reasons still owed: asked, with an empty box. */
export function owedReasons(judged: readonly Judged[], reasons: Record<string, string>): Judged[] {
  return askedForReason(judged).filter((j) => !String(reasons[j.targetId] ?? "").trim());
}

/**
 * The reasons a skipped day still owes, from the last closed End of day before today (sent or skipped, within a
 * week): only when that day was skipped, so they are asked on the next End of day and not again after a later send.
 */
export function owedFromLastClosed(last: { day: string; status: string; judged: readonly Judged[]; reasons: Record<string, string> } | null): { day: string; items: Judged[]; reasons: Record<string, string> } | null {
  if (!last || last.status !== "skipped") return null;
  const items = askedForReason(last.judged).filter((j) => !String(last.reasons[j.targetId] ?? "").trim());
  return items.length ? { day: last.day, items, reasons: last.reasons } : null;
}

/** "2 commitments have no reason yet. Jake sees "(reason still to give)"." */
export function noReasonText(n: number, partnerFirst: string): string {
  return `${n} ${n === 1 ? "commitment has" : "commitments have"} no reason yet. ${partnerFirst} sees "(reason still to give)".`;
}

export type EodState = "open" | "sent" | "skipped";

/** The status line's three items with their state words. */
/**
 * The "Before you send" line on End of day: Reasons, (Fridays, push D) Weekly review with "2 of 3" until all three are
 * written, Tomorrow's line, Approve and send. `reviewAnswered` is null on other days.
 */
export function statusItems(owed: number, tomorrow: string, state: EodState, sentAt: string | null, reviewAnswered: number | null = null): { key: "reasons" | "review" | "tomorrow" | "send"; label: string; word: string | null; tone: "left" | "done" | "off" }[] {
  return [
    { key: "reasons", label: "Reasons", word: owed ? `${owed} left` : "done", tone: owed ? "left" : "done" },
    ...(reviewAnswered === null ? [] : [{ key: "review" as const, label: "Weekly review", word: reviewAnswered >= 3 ? "done" : `${reviewAnswered} of 3`, tone: (reviewAnswered >= 3 ? "done" : "left") as "done" | "left" }]),
    { key: "tomorrow", label: "Tomorrow's line", word: tomorrow.trim() ? "done" : "empty", tone: tomorrow.trim() ? "done" : "left" },
    { key: "send", label: "Approve and send", word: state === "sent" ? `sent ${sentAt ?? ""}`.trim() : state === "skipped" ? "skipped" : null, tone: state === "sent" ? "done" : "off" },
  ];
}

/** The End of day line on the Home tile. */
export function tileEodLine(owed: number, tomorrow: string, state: EodState, skipReason: string | null, friday: boolean, time: string = END_OF_DAY_TIME): string {
  if (state === "sent") return `Approved by you. Next report ${friday ? "Monday" : "tomorrow"} at ${time}.`;
  if (state === "skipped") return `Skipped${skipReason ? `: ${skipReason}` : ""}. Any reason still owed is asked ${friday ? "Monday" : "tomorrow"}.`;
  if (owed) return `Reasons (${owed} left), then approve and send`;
  if (!tomorrow.trim()) return "Tomorrow's line is empty; then approve and send";
  return "Reasons done; approve and send";
}

/** The report time shown on the End of day badge and the Home tile. */
export const END_OF_DAY_TIME = "5:30";

/** The next working day's name for the tomorrow card: "Tomorrow" Monday to Thursday, "Monday" on Friday (and the weekend). */
export function tomorrowLabel(day: string): "Tomorrow" | "Monday" {
  const w = weekdayShort(day);
  return w === "Fri" || w === "Sat" || w === "Sun" ? "Monday" : "Tomorrow";
}

/** The tile line under a target on Home: "Commitment · 2 to go before 5:30", "judged tonight, it is Friday". */
export function tileTargetLine(t: Target, value: number, today: string, time: string = END_OF_DAY_TIME): string {
  const parts: string[] = [];
  if (t.commitment) parts.push("Commitment");
  if (isMet(t, value)) parts.push("met");
  else if (t.cadence === "day") parts.push(`${t.number - value} to go before ${time}`);
  else if (weekdayShort(today) === "Fri") parts.push("judged tonight, it is Friday");
  else parts.push(`${t.number - value} to go this week`);
  return parts.join(" · ");
}

/** The two or three targets the Home tile shows: the Commitments first, then the rest by order, at most three. */
export function tileTargets(targets: readonly Target[], max = 3): Target[] {
  const sorted = [...targets].sort((a, b) => Number(b.commitment) - Number(a.commitment) || a.sortOrder - b.sortOrder);
  return sorted.slice(0, Math.min(max, sorted.length));
}

// ---------- The report's numbers (End of day email, Reports) ----------

type TileStatus = "met" | "soon" | "missed" | "neutral";
export type ReportTile = { label: string; value: string; small?: string; note: string; status: TileStatus; pct: number | null };

export type DayNumbers = {
  screened: Count;
  moves: { on: string; name: string; from: string | null; to: string; keyFinding: string | null; lane: string }[];
  calls: Count;
  emails: Count;
  outreachToday: Count;
  outreachWeek: Count;
  actionsDone: Count;
  /** Push E2: the next actions done by area, in the Area selector's order, only areas with at least one. */
  actionsByArea: { area: DoneArea; count: number }[];
  /** Push E2: the personal to-dos checked off. */
  todosDone: { value: number; list: string[] };
  /**
   * Open waits at or past the threshold, longest first: the deals ("Summit Logistics Group (11 days, Mark Reed)") and,
   * push E2, the people waited on (End of day's Today line and its drawer).
   */
  waits: { name: string; days: number; who: string | null; what: string | null; since: string | null; kind?: "deal" | "person" }[];
  /** Every open wait on a deal (for the average on Reports). */
  allWaits: { name: string; days: number; who: string | null; what: string | null; since: string | null; kind?: "deal" | "person" }[];
  /** What the Today strip's drawers list (Edit batch C, item 10): the listings screened with the pass reason or Interested. */
  screenedList: { name: string; outcome: "passed" | "interested"; reason: string | null }[];
  /** The calls (calls, meetings, video calls) and emails sent today, with the person's name. */
  contactsList: { name: string; kind: "call" | "email"; method: string }[];
  /** The next actions marked Done today (and tasks on records checked off), with the record, the action, and the area. */
  actionsDoneList: { name: string; label: string; area: DoneArea }[];
};

/**
 * The counted facts of one day (End of day's Today strip and its drawers, and the email's Today tiles). `people` are
 * the people waited on (push E2): they count in `waits` with the deals; `allWaits` stays deals only.
 */
export function dayNumbers(f: Facts, day: string, waits: DayNumbers["allWaits"], threshold: number, people: DayNumbers["allWaits"] = []): DayNumbers {
  const week = workWeekOf(day);
  const done = f.actionsDone.filter((x) => x.on === day);
  const todos = (f.todosDone ?? []).filter((x) => x.on === day);
  return {
    screened: countIn("listings_screened", f, day, day),
    moves: f.moves.filter((m) => m.on === day),
    calls: countIn("calls_logged", f, day, day),
    emails: countIn("emails_sent", f, day, day),
    outreachToday: countIn("outreach_contacts", f, day, day),
    outreachWeek: countIn("outreach_contacts", f, week.start, week.end),
    actionsDone: countIn("next_actions_done", f, day, day),
    actionsByArea: DONE_AREAS.map((area) => ({ area, count: done.filter((x) => x.area === area).length })).filter((a) => a.count > 0),
    todosDone: { value: todos.length, list: todos.map((t) => t.text) },
    waits: [...waits.map((w) => ({ ...w, kind: w.kind ?? ("deal" as const) })), ...people.map((p) => ({ ...p, kind: "person" as const }))].filter((w) => w.days >= threshold).sort((a, b) => b.days - a.days),
    allWaits: waits,
    screenedList: f.screened.filter((x) => x.on === day).map((x) => ({ name: x.name, outcome: x.outcome, reason: x.reason })),
    contactsList: f.comms.filter((c) => c.on === day && (c.method === "email" || isCall(c.method))).map((c) => ({ name: c.contactName ?? "Someone not on Contacts", kind: c.method === "email" ? ("email" as const) : ("call" as const), method: c.method })),
    actionsDoneList: done.map((x) => ({ name: x.name, label: x.label, area: x.area })),
  };
}

/**
 * The Today strip at the top of End of day (Edit batch C, item 10): "Today: 4 screened · 0 moved · 0 calls · 0 emails
 * · 0 next actions done · 2 waiting 5+ days". Each part is a link to its drawer. The figures are the same counts
 * as the report's Today tiles (dayNumbers).
 */
export type TodayPart = { key: "screened" | "moved" | "calls" | "emails" | "done" | "todos" | "waits"; value: number; words: string; /** Push E2: after a colon, the next actions done by area ("Deals 2 · Rosara 1"). */ detail?: string | null };

/**
 * Push E2, item 5: "5 next actions done: Deals 2 · Rosara 1 · Job search 1 · Consulting 1" (only areas with at least
 * one; "0 next actions done" when none), then "N to-dos done" (personal to-dos checked off today), and "N waiting 5+
 * days" counts the deals and the people waited on.
 */
export function todayStrip(n: DayNumbers, threshold: number): TodayPart[] {
  const todos = n.todosDone?.value ?? 0;
  return [
    { key: "screened", value: n.screened.value, words: "screened" },
    { key: "moved", value: n.moves.length, words: "moved" },
    { key: "calls", value: n.calls.value, words: n.calls.value === 1 ? "call" : "calls" },
    { key: "emails", value: n.emails.value, words: n.emails.value === 1 ? "email" : "emails" },
    { key: "done", value: n.actionsDone.value, words: n.actionsDone.value === 1 ? "next action done" : "next actions done", detail: n.actionsDone.value && n.actionsByArea?.length ? n.actionsByArea.map((a) => `${a.area} ${a.count}`).join(" · ") : null },
    { key: "todos", value: todos, words: todos === 1 ? "to-do done" : "to-dos done" },
    { key: "waits", value: n.waits.length, words: `waiting ${threshold}+ days` },
  ];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The Today tiles of the report: Listings screened, Deals moved, Next actions done, Calls, Emails, Network outreach. */
export function todayTiles(n: DayNumbers, targets: readonly Target[]): ReportTile[] {
  const tOf = (key: CountKey) => targets.find((t) => t.key === key) ?? null;
  const tile = (label: string, value: number, t: Target | null, note: string, noTargetNote = note): ReportTile => {
    if (!t || t.cadence !== "day") return { label, value: String(value), note: noTargetNote, status: "neutral", pct: null };
    return { label, value: String(value), small: `of ${t.number}`, note, status: value >= t.number ? "met" : "missed", pct: clamp((value / t.number) * 100) };
  };
  const out: ReportTile[] = [];
  out.push(tile("Listings screened", n.screened.value, tOf("listings_screened"), n.screened.detail));
  out.push({ label: "Deals moved", value: String(n.moves.length), note: listNames([...new Set(n.moves.map((m) => `${shortName(m.name)} to ${m.to}`))], 2), status: "neutral", pct: null });
  out.push(tile("Next actions done", n.actionsDone.value, tOf("next_actions_done"), n.actionsDone.detail));
  out.push({ label: "Calls", value: String(n.calls.value), note: n.calls.detail, status: "neutral", pct: null });
  out.push({ label: "Emails", value: String(n.emails.value), note: n.emails.detail, status: "neutral", pct: null });
  const outreach = tOf("outreach_contacts");
  out.push(outreach && outreach.cadence === "week" ? { label: "Network outreach", value: String(n.outreachToday.value), note: `${n.outreachWeek.value} of ${outreach.number} this week`, status: n.outreachWeek.value >= outreach.number ? "met" : "missed", pct: clamp((n.outreachWeek.value / outreach.number) * 100) } : { label: "Network outreach", value: String(n.outreachToday.value), note: `${n.outreachWeek.value} this week`, status: "neutral", pct: null });
  return out;
}

export type WeekNumbers = { period: Period; targetsMet: { met: number; total: number; names: string[]; missedNames: string[] }; deals: Count; screened: Count; outreach: { value: number; target: number | null }; followUps: Count; waitAverage: { days: number; n: number; longest: { name: string; days: number } | null } };

/** The figures of a week (or any period) for Reports and the Friday email. */
export function weekNumbers(targets: readonly Target[], f: Facts, p: Period, waits: DayNumbers["allWaits"], skipped: readonly string[] = [], today?: string): WeekNumbers {
  // A per-weekday target is judged against the weekdays counted so far (up to today, less the skipped days), as the Targets card does.
  const upTo = today && today < p.end ? { start: p.start, end: today } : p;
  const days = Math.max(1, weekdaysIn(upTo) - skipped.filter((d) => d >= upTo.start && d <= upTo.end).length);
  const names: string[] = [];
  const missedNames: string[] = [];
  for (const t of targets) {
    const v = countIn(t.key, f, p.start, p.end).value;
    const required = t.cadence === "day" ? t.number * days : t.number;
    if (v >= required) names.push(t.name);
    else missedNames.push(t.name);
  }
  const outreach = targets.find((t) => t.key === "outreach_contacts");
  const avg = waits.length ? Math.round((waits.reduce((s, w) => s + w.days, 0) / waits.length) * 10) / 10 : 0;
  const longest = waits.length ? waits.reduce((a, b) => (b.days > a.days ? b : a)) : null;
  return {
    period: p,
    targetsMet: { met: names.length, total: targets.length, names, missedNames },
    deals: countIn("deals_moved", f, p.start, p.end),
    screened: countIn("listings_screened", f, p.start, p.end),
    outreach: { value: countIn("outreach_contacts", f, p.start, p.end).value, target: outreach && outreach.cadence === "week" ? outreach.number : null },
    followUps: countIn("follow_ups_on_time", f, p.start, p.end),
    waitAverage: { days: avg, n: waits.length, longest: longest ? { name: longest.name, days: longest.days } : null },
  };
}

/** The weekdays (Mon to Fri) in a period. */
function weekdaysIn(p: Period): number {
  let n = 0;
  for (let d = p.start; d <= p.end; d = addDaysISO(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** The six figure tiles of "The week" (Reports) and the Friday section of the email. */
export function weekTiles(w: WeekNumbers, last: WeekNumbers | null): ReportTile[] {
  const tm = w.targetsMet;
  const tiles: ReportTile[] = [
    { label: "Targets met", value: String(tm.met), small: `of ${tm.total}`, note: tm.missedNames.length ? `Missed: ${listNames(tm.missedNames.map(shortTargetName), 2)}` : last ? `Last week ${last.targetsMet.met} of ${last.targetsMet.total}` : "", status: tm.total ? (tm.met === tm.total ? "met" : "missed") : "neutral", pct: tm.total ? clamp((tm.met / tm.total) * 100) : null },
    { label: "Deals moved", value: String(w.deals.value), note: listNames([...new Set(w.deals.names.map(shortName))], 2), status: "neutral", pct: null },
    { label: "Listings screened", value: String(w.screened.value), note: w.screened.detail, status: "neutral", pct: null },
    w.outreach.target
      ? { label: "Network outreach", value: String(w.outreach.value), small: `of ${w.outreach.target}`, note: last ? `Last week ${last.outreach.value}${last.outreach.target ? ` of ${last.outreach.target}` : ""}` : "", status: w.outreach.value >= w.outreach.target ? "met" : "missed", pct: clamp((w.outreach.value / w.outreach.target) * 100) }
      : { label: "Network outreach", value: String(w.outreach.value), note: "", status: "neutral", pct: null },
    { label: "Follow-ups on time", value: `${w.followUps.value}%`, note: w.followUps.detail, status: w.followUps.parts?.done ? (w.followUps.value >= 100 ? "met" : "missed") : "neutral", pct: w.followUps.parts?.done ? clamp(w.followUps.value) : null },
    { label: "Days waiting on brokers", value: w.waitAverage.n ? w.waitAverage.days.toFixed(1) : "0", note: w.waitAverage.n ? `${w.waitAverage.n} open ${w.waitAverage.n === 1 ? "wait" : "waits"}${w.waitAverage.longest ? ` · ${shortName(w.waitAverage.longest.name)} ${w.waitAverage.longest.days} days` : ""}` : "No open waits", status: "neutral", pct: null },
  ];
  return tiles;
}

// ---------- Reports, regrouped (Edit batch C round 2, item 6) ----------

/** The target furthest behind in a period: its name, figure, and how far along (0 to 1); null when every target is met. */
type MostMissedIn = { name: string; figure: string; share: number; weeks?: { missed: number; of: number } } | null;

/**
 * "Most missed this week" (or last week, a past week): the target furthest below its target, by share of the target
 * reached (a per-weekday target against number times the weekdays counted up to today, less skipped days). Over a
 * month: the target missed in most of the month's judged weeks (ties go to the one furthest behind this week).
 */
export function mostMissedIn(targets: readonly Target[], f: Facts, p: Period, today: string, skipped: readonly string[] = [], month = false): MostMissedIn {
  if (month) {
    const misses = new Map<string, number>();
    let weeks = 0;
    for (let s = workWeekOf(p.start).start; s <= today; s = addDaysISO(s, 7)) {
      const end = addDaysISO(s, 4);
      if (end >= today) continue;
      weeks++;
      for (const m of judgeWeek(targets, f, s, skipped).missed) misses.set(m.name, (misses.get(m.name) ?? 0) + 1);
    }
    let best: MostMissedIn = null;
    for (const t of targets) {
      const n = misses.get(t.name) ?? 0;
      if (n > 0 && (!best || n > (best.weeks?.missed ?? 0))) best = { name: t.name, figure: `${n} of ${weeks} weeks`, share: 1 - n / weeks, weeks: { missed: n, of: weeks } };
    }
    return best;
  }
  const upTo = today < p.end ? { start: p.start, end: today } : p;
  const days = Math.max(1, weekdaysIn(upTo) - skipped.filter((d) => d >= upTo.start && d <= upTo.end).length);
  let best: MostMissedIn = null;
  for (const t of targets) {
    const v = countIn(t.key, f, p.start, p.end).value;
    const required = t.cadence === "day" ? t.number * days : t.number;
    if (required <= 0 || v >= required) continue;
    const share = v / required;
    if (!best || share < best.share) best = { name: t.name, figure: t.cadence === "day" ? `${v} of ${required}` : countable(t.key).unit === "yesno" ? "not done" : figure(t, v), share };
  }
  return best;
}

/**
 * The six tiles of "How the week went" on Reports (Edit batch C round 2, item 6): Deals moved, Listings screened,
 * Network outreach, Follow-ups on time, Days waiting on brokers, and Most missed (in place of Targets met). Nothing
 * repeats what the cards below show: the moves, the passes, and the waits are listed in the cards, so the tiles carry
 * last week's figure instead of the names, and Most missed names the target without its figure (the figure is in the
 * Targets card). `open`: the period is still being counted, so nothing reads as missed yet.
 */
export function reportTiles(w: WeekNumbers, last: WeekNumbers | null, most: MostMissedIn, opts: { label: string; open: boolean; month?: boolean }): ReportTile[] {
  const lastLine = (n: number | null) => (last && n !== null ? `Last week ${n}` : "");
  const tiles: ReportTile[] = [
    { label: "Deals moved", value: String(w.deals.value), note: lastLine(last ? last.deals.value : null), status: "neutral", pct: null },
    { label: "Listings screened", value: String(w.screened.value), note: lastLine(last ? last.screened.value : null), status: "neutral", pct: null },
    w.outreach.target && !opts.month
      ? { label: "Network outreach", value: String(w.outreach.value), small: `of ${w.outreach.target}`, note: last ? `Last week ${last.outreach.value}` : "", status: w.outreach.value >= w.outreach.target ? "met" : opts.open ? "neutral" : "missed", pct: clamp((w.outreach.value / w.outreach.target) * 100) }
      : { label: "Network outreach", value: String(w.outreach.value), note: lastLine(last ? last.outreach.value : null), status: "neutral", pct: null },
    // Counts only (no names): the people are on Outreach and in the Waiting card, so nothing repeats.
    { label: "Follow-ups on time", value: `${w.followUps.value}%`, note: w.followUps.parts?.done ? `${w.followUps.parts.onTime} of ${w.followUps.parts.done} on time` : "None due", status: w.followUps.parts?.done ? (w.followUps.value >= 100 ? "met" : opts.open ? "neutral" : "missed") : "neutral", pct: w.followUps.parts?.done ? clamp(w.followUps.value) : null },
    { label: "Days waiting on brokers", value: w.waitAverage.n ? w.waitAverage.days.toFixed(1) : "0", note: w.waitAverage.n ? `Average of ${w.waitAverage.n} open ${w.waitAverage.n === 1 ? "wait" : "waits"}` : "No open waits", status: "neutral", pct: null },
    most
      ? { label: opts.label, value: shortTargetName(most.name), note: most.weeks ? `Missed ${most.weeks.missed} of ${most.weeks.of} weeks` : opts.open ? "Furthest behind so far" : "Furthest behind", status: opts.open ? "neutral" : "missed", pct: null }
      : { label: opts.label, value: "None", note: opts.open ? "Every target met so far" : "Every target met", status: opts.open ? "neutral" : "met", pct: null },
  ];
  return tiles;
}

/** The one-line summary saved with a sent report (the row on Sent reports). */
export function reportSummary(judged: readonly Judged[], n: DayNumbers, withWeek: boolean): string {
  const parts: string[] = [];
  if (withWeek) parts.push(`${judged.filter((j) => j.met).length} of ${judged.length} targets met`);
  else {
    const screened = judged.find((j) => j.key === "listings_screened");
    if (screened) parts.push(`${screened.name} ${screened.figure}`);
  }
  for (const m of n.moves.slice(0, 2)) parts.push(`${shortName(m.name)} to ${m.to}`);
  const names = [...new Set([...n.calls.names, ...n.emails.names])].slice(0, 2);
  if (names.length) parts.push(`${names.join(" and ")} contacted`);
  if (withWeek) parts.push("the week added");
  return parts.slice(0, 4).join(" · ");
}
