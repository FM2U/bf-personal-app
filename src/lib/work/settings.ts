/**
 * Settings, Work settings (push D, approved mockup 2026-11-02 V.setup), pure and tested in src/lib/work/settings.test.ts:
 * the five values (push E added No reply yet) and their checks, the End of day time in the forms the screens show ("5:30", "5:30 pm"), and the
 * check of a pipeline's stage defaults before Save. The values are saved as settings rows (table inputs) except the
 * default block length, which is on the profile (owner_profile.default_block_minutes, push C).
 */

/** The settings rows the Work settings card writes, with their labels for the inputs table. */
export const WORK_SETTING_KEYS = {
  threshold: { key: "waiting_threshold_days", label: "Amber after (days)", unit: "number", description: "Waiting on someone: at this many days with no answer, the wait turns amber (time to follow up)." },
  /** Bram, 2026-11-08: its own number (it was double the follow-up number). */
  stalled: { key: "waiting_stalled_days", label: "Red after (days)", unit: "number", description: "Waiting on someone: at this many days with no answer, the wait turns red (stalled)." },
  /** Bram, 2026-11-08: the report goes out by itself at the send time on the partners' days (1 on, 0 off; on unless set). */
  autoSend: { key: "report_auto_send", label: "Send the report automatically", unit: "number", description: "End of day: the report goes to the partners due at the send time, with reminders 2 hours and 30 minutes before." },
  /** Push E: an email the app sent shows under No reply yet when no reply has come after this many days (default 2). */
  noReply: { key: "no_reply_after_days", label: "No reply yet after (days)", unit: "number", description: "Waiting on someone, No reply yet: an email the app sent shows there when no reply has come after this many days." },
  outreach: { key: "outreach_weekly_target", label: "Network outreach per week", unit: "number", description: "The weekly outreach counter on Contacts and Home." },
  eodTime: { key: "end_of_day_time", label: "Report goes out at", unit: "text", description: "The time the report goes out on the partners' days (HH:MM, 24-hour)." },
  /** Bram, 2026-11-09: targets count from this day; days before it are not counted and weeks that end before it are not judged. */
  countingStart: { key: "counting_start", label: "Counting starts on", unit: "text", description: "Targets: days before this date are not counted, and weeks that end before it are not judged (YYYY-MM-DD)." },
} as const;

/** The report's send time unless changed (Bram, 2026-11-08: 6:00 pm). */
export const DEFAULT_EOD_TIME = "18:00";

export type WorkSettings = { threshold: number; stalled: number; noReply: number; outreach: number; eodTime: string; blockMinutes: number; autoSend: boolean; /** Counting starts on (YYYY-MM-DD), or null: every day counts (2026-11-09). */ countingStart: string | null };

/** "2026-11-09" when it is a real calendar date; null for anything else. */
export function parseDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** "17:30" -> "5:30"; anything not a time reads as the default. */
export function eodShort(hhmm: string | null | undefined): string {
  const t = parseTime(hhmm) ?? DEFAULT_EOD_TIME;
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
}

/** "17:30" -> "5:30 pm". */
export function eodLong(hhmm: string | null | undefined): string {
  const t = parseTime(hhmm) ?? DEFAULT_EOD_TIME;
  return `${eodShort(t)} ${Number(t.slice(0, 2)) < 12 ? "am" : "pm"}`;
}

/** Where the clock stands against the End of day time: minutes left (rounded up), passed, or a day other than `day`. */
export type EodCountdown = { kind: "left"; minutes: number } | { kind: "passed" } | { kind: "other-day" };

/**
 * The countdown at the top right of End of day (approved 2026-11-05): `now` read as the wall clock in the owner's
 * time zone, against the End of day time on `day` (YYYY-MM-DD). A page left open past midnight shows another day.
 */
export function eodCountdown(now: Date, tz: string, day: string, hhmm: string | null | undefined): EodCountdown {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (`${get("year")}-${get("month")}-${get("day")}` !== day) return { kind: "other-day" };
  const [h, m] = (parseTime(hhmm) ?? DEFAULT_EOD_TIME).split(":").map(Number);
  const left = h * 3600 + m * 60 - (Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")));
  return left > 0 ? { kind: "left", minutes: Math.ceil(left / 60) } : { kind: "passed" };
}

/** 72 -> "1 hr 12 min left", 45 -> "45 min left", 120 -> "2 hr left". */
export function minutesLeftWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} hr` : null, m || !h ? `${m} min` : null].filter(Boolean).join(" ")} left`;
}

/** "17:30" or "9:05" as "HH:MM"; null for anything else. */
export function parseTime(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const whole = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
};

/** The Work settings card's values checked for Save; the first problem as one plain sentence. */
export function cleanWorkSettings(input: { threshold: unknown; stalled?: unknown; noReply: unknown; outreach: unknown; eodTime: unknown; blockMinutes: unknown; autoSend?: unknown; countingStart?: unknown }, today?: string): { ok: true; value: WorkSettings } | { ok: false; error: string } {
  const threshold = whole(input.threshold);
  if (!(threshold >= 1 && threshold <= 60)) return { ok: false, error: "Amber after: a whole number of days from 1 to 60." };
  const stalled = input.stalled === undefined || String(input.stalled).trim() === "" ? threshold * 2 : whole(input.stalled);
  if (!(stalled > threshold && stalled <= 120)) return { ok: false, error: `Red after: a whole number of days more than ${threshold} (Amber after), up to 120.` };
  // Push E: up to 29, inside the 30 days replies are read for.
  const noReply = whole(input.noReply);
  if (!(noReply >= 1 && noReply <= 29)) return { ok: false, error: "No reply yet: a whole number of days from 1 to 29." };
  const outreach = whole(input.outreach);
  if (!(outreach >= 1 && outreach <= 200)) return { ok: false, error: "Network outreach: a whole number from 1 to 200 per week." };
  const eodTime = parseTime(input.eodTime);
  if (!eodTime) return { ok: false, error: "Report goes out at: a time such as 6:00 pm." };
  const blockMinutes = whole(input.blockMinutes);
  if (!(blockMinutes >= 5 && blockMinutes <= 480)) return { ok: false, error: "Default block length: 5 to 480 minutes." };
  // Counting starts on (2026-11-09): blank counts every day; a date may not be after today.
  const rawStart = String(input.countingStart ?? "").trim();
  const countingStart = rawStart ? parseDay(rawStart) : null;
  if (rawStart && !countingStart) return { ok: false, error: "Counting starts on: a date such as Nov 9, 2026, or blank." };
  if (countingStart && today && countingStart > today) return { ok: false, error: "Counting starts on: a date no later than today." };
  return { ok: true, value: { threshold, stalled, noReply, outreach, eodTime, blockMinutes, autoSend: input.autoSend === undefined ? true : input.autoSend === true || input.autoSend === "1" || input.autoSend === "true", countingStart } };
}

/** One stage's defaults as the table sends them. */
export type StageDefaultInput = { stageId: string; title: string; dueInDays: unknown; /** Left out: the stage's time limit stays as it is. */ timeLimit?: unknown };
export type StageDefault = { stageId: string; title: string; dueInDays: number; /** Undefined: not sent, left as it is. */ timeLimit?: number | null };

/** The stage defaults checked for Save: the next action text (blank removes the default), due in 0 to 365 days, a time limit of 1 to 365 days or blank. */
export function cleanStageDefaults(rows: readonly StageDefaultInput[], names: Record<string, string>): { ok: true; rows: StageDefault[] } | { ok: false; error: string } {
  const out: StageDefault[] = [];
  for (const r of rows) {
    const name = names[r.stageId];
    if (!name) continue;
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const due = String(r.dueInDays ?? "").trim() === "" ? 2 : whole(r.dueInDays);
    if (!(due >= 0 && due <= 365)) return { ok: false, error: `${name}: due in 0 to 365 days.` };
    if (r.timeLimit === undefined) {
      out.push({ stageId: r.stageId, title, dueInDays: due });
      continue;
    }
    const limitRaw = String(r.timeLimit ?? "").trim();
    const limit = limitRaw === "" ? null : whole(limitRaw);
    if (limit !== null && !(limit >= 1 && limit <= 365)) return { ok: false, error: `${name}: a time limit of 1 to 365 days, or blank for none.` };
    out.push({ stageId: r.stageId, title, dueInDays: due, timeLimit: limit });
  }
  return { ok: true, rows: out };
}
