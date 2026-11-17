/**
 * The 4:00 pm AI drafts of the report (Bram, 2026-11-15; claude/2026-11-15-report-redesign-decisions-log.md, step 4),
 * pure and tested in src/lib/accountability/report-drafts.test.ts: the opening (3 to 5 sentences), tomorrow's line,
 * and each top priority's "Now" line (where it stands and what to focus on). One AI request writes all of them; the
 * app keeps which text is still an AI draft, so End of day marks it until the owner edits it or presses Keep, and a
 * redraft never writes over text the owner typed or kept.
 */
import { stripDashes } from "@/lib/work/ask-ai";

/** Where the drafts are kept: this key of the day's end_of_day.report_edits. */
export const DRAFTS_KEY = "_drafts";

export type NowLine = { text: string; /** Still the AI's text (not edited, not kept). */ ai: boolean };
export type ReportDrafts = {
  /** When the AI last wrote them (ISO), or null. */
  at: string | null;
  /** The opening is still the AI's draft. */
  opening: boolean;
  /** Tomorrow's line is still the AI's draft. */
  tomorrow: boolean;
  /** Each pick's Now line by record id. */
  now: Record<string, NowLine>;
};
export const NO_DRAFTS: ReportDrafts = { at: null, opening: false, tomorrow: false, now: {} };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOW_MAX = 220;
export const OPENING_DRAFT_MAX = 1200;
export const TOMORROW_MAX = 600;

/** The drafts as saved (unknown keys out, text trimmed and cut). */
export function cleanDrafts(v: unknown): ReportDrafts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...NO_DRAFTS, now: {} };
  const o = v as Record<string, unknown>;
  const now: Record<string, NowLine> = {};
  const raw = o.now && typeof o.now === "object" && !Array.isArray(o.now) ? (o.now as Record<string, unknown>) : {};
  for (const [id, x] of Object.entries(raw)) {
    if (!UUID.test(id) || !x || typeof x !== "object") continue;
    const t = String((x as Record<string, unknown>).text ?? "").replace(/\s+/g, " ").trim().slice(0, NOW_MAX);
    if (t) now[id] = { text: t, ai: (x as Record<string, unknown>).ai === true };
  }
  return { at: typeof o.at === "string" ? o.at.slice(0, 40) : null, opening: o.opening === true, tomorrow: o.tomorrow === true, now };
}

/** One top priority as the prompt describes it. */
export type DraftPick = { id: string; track: string; name: string; stage: string | null; why: string | null; nextAction: string | null; nextActionDue: string | null; nextDecision: string | null; movedToday: boolean; waiting: string | null; notes: string[] };

/** The request: the day's lines (as on End of day), what moved, each pick, and the next working day's actions. */
/** A listing's "00 " start is never shown to partners (2026-11-16), so it never reaches the AI either. */
export function withoutPlaceholders(line: string): string {
  return line.replace(/(^|[\s(,;])00 (?=\S)/g, "$1");
}

export function draftsPrompt(i: { dateLabel: string; tomorrowLabel: string; dayLines: string[]; activity: string[]; picks: DraftPick[]; dueNext: string[]; want: { opening: boolean; tomorrow: boolean; now: string[] } }): string {
  const asks: string[] = [];
  if (i.want.opening) asks.push('"opening": 3 to 5 plain sentences on what the day was about: the main move, what was learned, what is stuck. Concrete names and facts from the lines below only. Do not state counts of calls, emails, outreach, to-dos or next actions: the report shows the day\'s counts, and the day is not over when this is written.');
  if (i.want.tomorrow) asks.push(`"tomorrow": one line (at most 30 words) on what matters most on ${i.tomorrowLabel === "Tomorrow" ? "the next working day" : i.tomorrowLabel}, from the next actions due and the open waits.`);
  if (i.want.now.length) asks.push('"now": for each top priority listed with "now: write", one line (at most 25 words): where it stands now and what to focus on next, from its stage, next action, notes, waits and today\'s moves.');
  return [
    "TASK: report_drafts",
    "The signed-in user sends a short daily report to an accountability partner. Draft parts of it in the user's own voice: first person, plain words, no greeting, no sign-off, no hype, no apologies. Use only facts in the lines below; do not invent numbers, names or dates.",
    "",
    `Page: End of day, ${i.dateLabel}`,
    "The day (one line each):",
    ...i.dayLines.map((l) => `- ${l}`),
    ...(i.activity.length ? ["", "What moved on the deals and jobs today:", ...i.activity.map((l) => `- ${l}`)] : []),
    "",
    "Top priorities:",
    ...(i.picks.length
      ? i.picks.map((p) =>
          [
            `- id ${p.id} | ${p.track} | ${p.name}`,
            p.stage ? `stage ${p.stage}${p.movedToday ? " (moved there today)" : ""}` : null,
            p.why ? `why it fits: ${p.why}` : null,
            p.nextAction ? `next action: ${p.nextAction}${p.nextActionDue ? ` (due ${p.nextActionDue})` : ""}` : "no next action set",
            p.nextDecision ? `next decision: ${p.nextDecision}` : null,
            p.waiting ? `waiting: ${p.waiting}` : null,
            ...p.notes.map((n) => `note: ${n}`),
            i.want.now.includes(p.id) ? "now: write" : "now: keep",
          ]
            .filter(Boolean)
            .join(" | "),
        )
      : ["- none chosen"]),
    ...(i.dueNext.length ? ["", `Next actions due ${i.tomorrowLabel === "Tomorrow" ? "on the next working day" : `on ${i.tomorrowLabel}`}:`, ...i.dueNext.map((l) => `- ${l}`)] : []),
    "",
    "Write:",
    ...asks.map((a) => `- ${a}`),
    "",
    `Return only JSON with these keys: {${[i.want.opening ? '"opening": "..."' : null, i.want.tomorrow ? '"tomorrow": "..."' : null, i.want.now.length ? '"now": [{"id": "<id>", "text": "..."}]' : null].filter(Boolean).join(", ")}}`,
  ].join("\n");
}

export type DraftsReply = { opening: string | null; tomorrow: string | null; now: Record<string, string> };

const line = (v: unknown, max: number) => (typeof v === "string" ? stripDashes(v.replace(/\s+/g, " ")).trim().slice(0, max) : "");

/** The reply: the parts asked for, each cleaned; Now lines matched to the asked ids. */
export function validateDraftsReply(value: unknown, want: { opening: boolean; tomorrow: boolean; now: string[] }): { ok: true; value: DraftsReply } | { ok: false; error: string } {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : null) as Record<string, unknown> | null;
  if (!v) return { ok: false, error: "the reply needs a JSON object" };
  const opening = want.opening ? stripDashes(String(v.opening ?? "").replace(/\r/g, "")).trim().slice(0, OPENING_DRAFT_MAX) : "";
  const tomorrow = want.tomorrow ? line(v.tomorrow, TOMORROW_MAX) : "";
  if (want.opening && !opening) return { ok: false, error: 'the reply needs "opening"' };
  if (want.tomorrow && !tomorrow) return { ok: false, error: 'the reply needs "tomorrow"' };
  const now: Record<string, string> = {};
  if (want.now.length) {
    const list = Array.isArray(v.now) ? v.now : [];
    for (const x of list) {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const id = String(o.id ?? "");
      const t = line(o.text, NOW_MAX);
      if (want.now.includes(id) && t) now[id] = t;
    }
    if (!Object.keys(now).length) return { ok: false, error: 'the reply needs "now" lines with the ids asked for' };
  }
  return { ok: true, value: { opening: opening || null, tomorrow: tomorrow || null, now } };
}

/**
 * What a draft may write: the opening and tomorrow's line only when empty or still an AI draft; a Now line only when
 * none is saved or it is still the AI's. Text the owner typed, edited or kept is never written over.
 */
export function draftTargets(i: { opening: string; tomorrow: string; drafts: ReportDrafts; pickIds: string[] }): { opening: boolean; tomorrow: boolean; now: string[] } {
  return {
    opening: !i.opening.trim() || i.drafts.opening,
    tomorrow: !i.tomorrow.trim() || i.drafts.tomorrow,
    now: i.pickIds.filter((id) => !i.drafts.now[id] || i.drafts.now[id].ai),
  };
}
