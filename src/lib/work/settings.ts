/**
 * Settings, Work settings (push D, approved mockup 2026-11-02 V.setup), pure and tested in src/lib/work/settings.test.ts:
 * the four values and their checks, the End of day time in the forms the screens show ("5:30", "5:30 pm"), and the
 * check of a pipeline's stage defaults before Save. The values are saved as settings rows (table inputs) except the
 * default block length, which is on the profile (owner_profile.default_block_minutes, push C).
 */

/** The settings rows the Work settings card writes, with their labels for the inputs table. */
export const WORK_SETTING_KEYS = {
  threshold: { key: "waiting_threshold_days", label: "Waiting on someone (days)", unit: "number", description: "Waiting on someone: at this many days or more, a deal's day count turns amber; at double, red." },
  outreach: { key: "outreach_weekly_target", label: "Network outreach per week", unit: "number", description: "The weekly outreach counter on Contacts and Home." },
  eodTime: { key: "end_of_day_time", label: "End of day time", unit: "text", description: "The time End of day shows for the report, weekdays (HH:MM, 24-hour)." },
} as const;

export const DEFAULT_EOD_TIME = "17:30";

export type WorkSettings = { threshold: number; outreach: number; eodTime: string; blockMinutes: number };

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
export function cleanWorkSettings(input: { threshold: unknown; outreach: unknown; eodTime: unknown; blockMinutes: unknown }): { ok: true; value: WorkSettings } | { ok: false; error: string } {
  const threshold = whole(input.threshold);
  if (!(threshold >= 1 && threshold <= 60)) return { ok: false, error: "Waiting on someone: a whole number of days from 1 to 60." };
  const outreach = whole(input.outreach);
  if (!(outreach >= 1 && outreach <= 200)) return { ok: false, error: "Network outreach: a whole number from 1 to 200 per week." };
  const eodTime = parseTime(input.eodTime);
  if (!eodTime) return { ok: false, error: "End of day: a time such as 5:30 pm." };
  const blockMinutes = whole(input.blockMinutes);
  if (!(blockMinutes >= 5 && blockMinutes <= 480)) return { ok: false, error: "Default block length: 5 to 480 minutes." };
  return { ok: true, value: { threshold, outreach, eodTime, blockMinutes } };
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
