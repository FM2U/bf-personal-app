/**
 * The 4:00 pm AI drafts of the report (Bram, 2026-11-15; claude/2026-11-15-report-redesign-decisions-log.md, step 4),
 * pure and tested in src/lib/accountability/report-drafts.test.ts: the opening, tomorrow's line, and (release 4,
 * 2026-11-16) each record worked on today's "Today" line, written from its kept rows of Today's activity. One AI
 * request writes all of them; the app keeps which text is still an AI draft, so End of day marks it until the owner
 * edits it or presses Keep, and a redraft never writes over text the owner typed or kept.
 */
import { stripDashes } from "@/lib/work/ask-ai";
import { openingLines } from "@/lib/accountability/opening-format";

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
  /** Each pick's Now line by record id (the report before release 4; kept as saved, no longer shown). */
  now: Record<string, NowLine>;
  /** Release 4 (2026-11-16): each record worked on today's Today line by record id. */
  today: Record<string, NowLine>;
};
export const NO_DRAFTS: ReportDrafts = { at: null, opening: false, tomorrow: false, now: {}, today: {} };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOW_MAX = 220;
export const OPENING_DRAFT_MAX = 1500;
export const TOMORROW_MAX = 600;

/** The drafts as saved (unknown keys out, text trimmed and cut). */
export function cleanDrafts(v: unknown): ReportDrafts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...NO_DRAFTS, now: {}, today: {} };
  const o = v as Record<string, unknown>;
  const lines = (val: unknown): Record<string, NowLine> => {
    const out: Record<string, NowLine> = {};
    const raw = val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
    for (const [id, x] of Object.entries(raw)) {
      if (!UUID.test(id) || !x || typeof x !== "object") continue;
      const t = String((x as Record<string, unknown>).text ?? "").replace(/\s+/g, " ").trim().slice(0, NOW_MAX);
      if (t) out[id.toLowerCase()] = { text: t, ai: (x as Record<string, unknown>).ai === true };
    }
    return out;
  };
  return { at: typeof o.at === "string" ? o.at.slice(0, 40) : null, opening: o.opening === true, tomorrow: o.tomorrow === true, now: lines(o.now), today: lines(o.today) };
}

/** One record worked on today as the prompt describes it (release 4): its kept rows of Today's activity are the facts of its Today line. */
export type DraftRecord = { id: string; track: string; name: string; stage: string | null; topPriority: number | null; newToday: boolean; moved: string | null; activity: string[]; nextAction: string | null; nextActionDue: string | null; waiting: string | null; notes: string[] };

/** The request: the day's lines (as on End of day), what moved, each pick, and the next working day's actions. */
/** A listing's "00 " start is never shown to partners (2026-11-16), so it never reaches the AI either. */
export function withoutPlaceholders(line: string): string {
  return line.replace(/(^|[\s(,;])00 (?=\S)/g, "$1");
}

/**
 * The opening as a summary by kind of work (Bram, 2026-11-18: rules settled 7:23 pm; claude/2026-11-18-fix-queue.md),
 * laid out as the approved layout H mockup shows it (Bram, 2026-11-23 7:44 pm: a bold heading per kind of work in free
 * wording, one or two bullets under it, no lead line). Saved with "**" for bold and "- " for bullets
 * (src/lib/accountability/opening-format.ts). The example is the mockup's own opening.
 */
export const OPENING_EXAMPLE = [
  "**Catalyst Evaluation Group: deep dive and seller meetings**",
  "- Held two in-depth conversations with the seller",
  "- Live product demo, service delivery walkthrough, discussed the seller's goals",
  "**Deal diligence across three active opportunities**",
  "- Reviewed financials and built pro forma projections and models",
  "- Drafted potential deal terms and structures for initial offers (IOIs)",
  "**Networking and outreach**",
  "- Connected with a new business broker and discussed deal referrals",
  "- Personal network outreach re referrals and industry expert connections",
].join("\n");
const OPENING_ASK = [
  '"opening": a summary picture of how the day was spent and how productive it was, as one string with a line break (\\n) between lines. The detail of each record is shown in the report under the opening, so the opening does not repeat it.',
  "  - No lead line and no sentence before the first heading.",
  '  - A heading line for each kind of work that day, usually two to four, in your own short wording (for example a deal and what was done on it, "Deal diligence across three active opportunities", "Networking and outreach", "Job search"). Each heading is on its own line with ** before it and ** after it (bold), and no colon at its end. The kind of work with the most work comes first.',
  '  - Under each heading: one or two lines, each starting with "- ", that name the deals or people and say what was done with its result or next step (a stage moved, a decision, something learned, the next call). Never a line that only says someone was contacted or something was shared. No ** marks in these lines.',
  '  - Show how much work it was without time: no hours and no minutes. Use the order, the results, words for scope ("three active opportunities", "both in one day") and specific verbs ("worked through the open diligence questions").',
  "  - No step-by-step detail, no internal task names, at most 12 lines in all. No other formatting.",
  "  - Numbers: never a number that repeats a figure in the today box or the Pipeline (listings reviewed, deals added, deals moved, brokers contacted, calls and meetings, network outreach, deals in a stage). Other numbers that add something are allowed: a deal's financials ($1.3M EBITDA), webinars attended, options found, \"2nd broker call\", days in a stage.",
  "  - Names and facts only from the lines below.",
  "  Example of the format and the voice (its names and facts are from another day; never reuse them):",
  ...OPENING_EXAMPLE.split("\n").map((l) => `    ${l}`),
].join("\n");

export function draftsPrompt(i: { dateLabel: string; tomorrowLabel: string; dayLines: string[]; activity: string[]; records: DraftRecord[]; dueNext: string[]; want: { opening: boolean; tomorrow: boolean; today: string[] } }): string {
  const asks: string[] = [];
  if (i.want.opening) asks.push(OPENING_ASK);
  if (i.want.tomorrow) asks.push(`"tomorrow": one line (at most 30 words) on what matters most on ${i.tomorrowLabel === "Tomorrow" ? "the next working day" : i.tomorrowLabel}, from the next actions due and the open waits.`);
  if (i.want.today.length) asks.push('"today": for each record listed with "today: write", one line (at most 20 words) on what was done on it today, from its "done today" lines only. Past tense, starting in lower case, with no "I" at the start (for example "signed the NDA and asked the broker for the CIM", "about an hour on the deal structure"). Do not repeat its stage, its next action or why it fits; the report shows those.');
  return [
    "TASK: report_drafts",
    "The signed-in user sends a short daily report to an accountability partner. Draft parts of it in the user's own voice: first person, plain words, no greeting, no sign-off, no hype, no apologies. Use only facts in the lines below; do not invent numbers, names or dates.",
    "",
    `Page: End of day, ${i.dateLabel}`,
    "The day (one line each):",
    ...i.dayLines.map((l) => `- ${l}`),
    ...(i.activity.length ? ["", "Today's activity (the rows kept on End of day):", ...i.activity.map((l) => `- ${l}`)] : []),
    "",
    "Records worked on today:",
    ...(i.records.length
      ? i.records.map((p) =>
          [
            `- id ${p.id} | ${p.track} | ${p.name}`,
            p.topPriority ? `top priority ${p.topPriority}` : null,
            p.newToday ? "new today" : null,
            p.stage ? `stage ${p.stage}` : null,
            p.moved ? p.moved : null,
            ...p.activity.map((a) => `done today: ${a}`),
            p.nextAction ? `next action: ${p.nextAction}${p.nextActionDue ? ` (due ${p.nextActionDue})` : ""}` : "no next action set",
            p.waiting ? `waiting: ${p.waiting}` : null,
            ...p.notes.map((n) => `note: ${n}`),
            i.want.today.includes(p.id) ? "today: write" : "today: keep",
          ]
            .filter(Boolean)
            .join(" | "),
        )
      : ["- none"]),
    ...(i.dueNext.length ? ["", `Next actions due ${i.tomorrowLabel === "Tomorrow" ? "on the next working day" : `on ${i.tomorrowLabel}`}:`, ...i.dueNext.map((l) => `- ${l}`)] : []),
    "",
    "Write:",
    ...asks.map((a) => `- ${a}`),
    "",
    `Return only JSON with these keys: {${[i.want.opening ? '"opening": "..."' : null, i.want.tomorrow ? '"tomorrow": "..."' : null, i.want.today.length ? '"today": [{"id": "<id>", "text": "..."}]' : null].filter(Boolean).join(", ")}}`,
  ].join("\n");
}

/** The AI's opening as saved: one line each, blank lines out, a typed "\\n" read as a line break, marks in pairs. */
export function tidyOpening(raw: string): string {
  return openingLines(raw.replace(/\\n/g, "\n"))
    .map((l) => {
      const t = l.text.replace(/\s+/g, " ");
      const even = (t.split("**").length - 1) % 2 === 0;
      return `${l.bullet ? "- " : ""}${even ? t : t.replace(/\*\*/g, "")}`;
    })
    .join("\n");
}

export type DraftsReply = { opening: string | null; tomorrow: string | null; today: Record<string, string> };

const line = (v: unknown, max: number) => (typeof v === "string" ? stripDashes(v.replace(/\s+/g, " ")).trim().slice(0, max) : "");

/** The reply: the parts asked for, each cleaned; Today lines matched to the asked ids. */
export function validateDraftsReply(value: unknown, want: { opening: boolean; tomorrow: boolean; today: string[] }): { ok: true; value: DraftsReply } | { ok: false; error: string } {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : null) as Record<string, unknown> | null;
  if (!v) return { ok: false, error: "the reply needs a JSON object" };
  const opening = want.opening ? tidyOpening(stripDashes(String(v.opening ?? "").replace(/\r/g, ""))).slice(0, OPENING_DRAFT_MAX) : "";
  const tomorrow = want.tomorrow ? line(v.tomorrow, TOMORROW_MAX) : "";
  if (want.opening && !opening) return { ok: false, error: 'the reply needs "opening"' };
  if (want.tomorrow && !tomorrow) return { ok: false, error: 'the reply needs "tomorrow"' };
  const today: Record<string, string> = {};
  if (want.today.length) {
    const list = Array.isArray(v.today) ? v.today : [];
    for (const x of list) {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const id = String(o.id ?? "").toLowerCase();
      const t = line(o.text, NOW_MAX);
      if (want.today.includes(id) && t) today[id] = t;
    }
    if (!Object.keys(today).length) return { ok: false, error: 'the reply needs "today" lines with the ids asked for' };
  }
  return { ok: true, value: { opening: opening || null, tomorrow: tomorrow || null, today } };
}

/**
 * What a draft may write: the opening and tomorrow's line only when empty or still an AI draft; a Today line only when
 * none is saved or it is still the AI's. Text the owner typed, edited or kept is never written over.
 */
export function draftTargets(i: { opening: string; tomorrow: string; drafts: ReportDrafts; recordIds: string[] }): { opening: boolean; tomorrow: boolean; today: string[] } {
  return {
    opening: !i.opening.trim() || i.drafts.opening,
    tomorrow: !i.tomorrow.trim() || i.drafts.tomorrow,
    today: i.recordIds.filter((id) => !i.drafts.today[id] || i.drafts.today[id].ai),
  };
}
