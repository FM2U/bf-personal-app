import { daysBetween } from "./dates";
import { missingRequiredFields, requiredFieldsForStage, type StageLite } from "./pipeline";

/**
 * Deal scorecard: four checks for one open pipeline item, each green, amber, or red, an overall color, and a score
 * ("3 of 4 on track"). Shown in the top right of the pipeline item window and the full item page, and as a dot in
 * pipeline list rows. Pure: the loaders pass the item, its stages, its detail record, and its status in.
 *
 *  1. Time in stage: days in the current stage against the stage time limit (Settings, Initiatives and pipelines;
 *     plus any "Extend 7 days" extensions). Green: no limit, or under 80% of it. Amber: 80% of the limit or more,
 *     still within it. Red: over the limit.
 *  2. Next action: green when set with a due date after today; amber when due today; red when overdue or missing
 *     (no action text or no due date).
 *  3. Required details: details the current stage (and every earlier stage) needs, filled x of y. Green: all filled
 *     (or none required). Amber: half or more filled. Red: fewer than half.
 *  4. Last activity: days since the last stage move, communication, completed task, note, or document. Green: under
 *     (stall days - 2, at least 3). Amber: from there up to the stall days. Red: the stall days or more (stalled).
 * Overall: red when any check is red, amber when any is amber, otherwise green. Score: checks that are green.
 */

export type ScoreColor = "green" | "amber" | "red";

export type ScorecardCheck = {
  key: "stage_time" | "next_action" | "required" | "activity";
  label: string;
  color: ScoreColor;
  /** Short value shown on the row, for example "12 of 14 days". */
  value: string;
  /** What the check means (hover or tap). */
  meaning: string;
  /** What to do now (hover or tap). Empty when nothing is needed. */
  todo: string;
};

export type Scorecard =
  | { open: false; reason: string }
  | { open: true; checks: ScorecardCheck[]; overall: ScoreColor; onTrack: number; total: number; scoreText: string };

export type ScorecardInput = {
  item: { status: string; stage_id: string | null; next_action?: string | null; next_action_due?: string | null };
  /** Every stage of the item's pipeline (position, outcome, required fields). */
  stages: StageLite[];
  /** The item's own fields merged with its detail record (deal financials, job details, and so on). */
  values: Record<string, unknown>;
  today: string;
  /** Days in the current stage (from the stage entry date). Null when unknown. */
  daysInStage: number | null;
  /** Stage time limit plus extensions; null when the stage has no limit. */
  limitDays: number | null;
  /** Latest activity date (YYYY-MM-DD), or null. */
  lastActivity: string | null;
  /** Inputs, Opportunities: days without activity before an item counts as stalled (default 7). */
  stallDays: number;
};

export const SCORE_LABEL: Record<ScoreColor, string> = { green: "On track", amber: "Needs attention", red: "Off track" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function stageTimeCheck(daysInStage: number | null, limitDays: number | null): ScorecardCheck {
  const meaning = "Days in the current stage compared with the stage time limit (set per stage in Settings, Initiatives and pipelines).";
  if (daysInStage === null) return { key: "stage_time", label: "Time in stage", color: "green", value: "Not known", meaning, todo: "" };
  if (limitDays === null || !(limitDays > 0)) return { key: "stage_time", label: "Time in stage", color: "green", value: `${plural(daysInStage, "day")}, no limit`, meaning, todo: "" };
  const value = `${daysInStage} of ${plural(limitDays, "day")}`;
  if (daysInStage > limitDays)
    return { key: "stage_time", label: "Time in stage", color: "red", value, meaning, todo: `Over the limit by ${plural(daysInStage - limitDays, "day")}. Move the item to the next stage, pass on it, or extend the time in Plan, Decisions.` };
  if (daysInStage >= Math.ceil(limitDays * 0.8))
    return { key: "stage_time", label: "Time in stage", color: "amber", value, meaning, todo: `${plural(limitDays - daysInStage, "day")} left in this stage. Plan the step that moves it forward.` };
  return { key: "stage_time", label: "Time in stage", color: "green", value, meaning, todo: "" };
}

export function nextActionCheck(action: string | null | undefined, due: string | null | undefined, today: string): ScorecardCheck {
  const meaning = "Every open item needs a next action with a due date. Overdue or missing counts as off track.";
  const base = { key: "next_action" as const, label: "Next action", meaning };
  if (!String(action ?? "").trim()) return { ...base, color: "red", value: "Missing", todo: "Press Edit and set the next action and its due date." };
  if (!due) return { ...base, color: "red", value: "No due date", todo: "Press Edit and give the next action a due date." };
  if (due < today) {
    const late = daysBetween(due, today);
    return { ...base, color: "red", value: `Overdue ${plural(late, "day")}`, todo: "Do the next action today, or press Edit and set a new due date." };
  }
  if (due === today) return { ...base, color: "amber", value: "Due today", todo: "Do the next action today, then press Done: set the next one." };
  return { ...base, color: "green", value: `Due in ${plural(daysBetween(today, due), "day")}`, todo: "" };
}

export function requiredCheck(stages: StageLite[], stageId: string | null, values: Record<string, unknown>): ScorecardCheck & { filled: number; required: number; missing: string[] } {
  const meaning = "Details this stage needs (and every earlier stage), filled out of required. They are set per stage in Settings, Initiatives and pipelines.";
  const required = stageId ? requiredFieldsForStage(stages, stageId) : [];
  const missing = missingRequiredFields(required, values).map((m) => m.label);
  const filled = required.length - missing.length;
  const base = { key: "required" as const, label: "Required details", meaning, filled, required: required.length, missing };
  if (!required.length) return { ...base, color: "green", value: "None required", todo: "" };
  const value = `${filled} of ${required.length} filled`;
  const todo = missing.length ? `Press Edit and fill: ${missing.join(", ")}.` : "";
  if (!missing.length) return { ...base, color: "green", value, todo };
  return { ...base, color: filled * 2 >= required.length ? "amber" : "red", value, todo };
}

/** Days without activity from which the check turns amber (the same day the "No activity" suggestion line starts). */
export function activityWarnDays(stallDays: number): number {
  const stall = Math.max(1, Number(stallDays) || 7);
  return Math.min(stall, Math.max(3, stall - 2));
}

export function activityCheck(lastActivity: string | null, today: string, stallDays: number): ScorecardCheck {
  const stall = Math.max(1, Number(stallDays) || 7);
  const meaning = `Days since the last stage move, logged call or email, completed task, note, or document. ${plural(stall, "day")} or more counts as stalled (Plan, Inputs, Opportunities).`;
  const base = { key: "activity" as const, label: "Last activity", meaning };
  if (!lastActivity) return { ...base, color: "red", value: "None logged", todo: "Log a call, email, or meeting with Log activity." };
  const days = Math.max(0, daysBetween(lastActivity, today));
  const value = days === 0 ? "Today" : `${plural(days, "day")} ago`;
  if (days >= stall) return { ...base, color: "red", value, todo: "Stalled. Contact the deal source or the main contact, then press Log activity." };
  if (days >= activityWarnDays(stall)) return { ...base, color: "amber", value, todo: `Stalled in ${plural(stall - days, "day")}. Plan a call or an email this week.` };
  return { ...base, color: "green", value, todo: "" };
}

/** Red when any check is red, amber when any is amber, otherwise green. */
export function overallColor(checks: { color: ScoreColor }[]): ScoreColor {
  if (checks.some((c) => c.color === "red")) return "red";
  if (checks.some((c) => c.color === "amber")) return "amber";
  return "green";
}

export function dealScorecard(input: ScorecardInput): Scorecard {
  if (input.item.status !== "open") return { open: false, reason: input.item.status === "won" ? "Won: no checks for a closed item." : "Closed: no checks for a closed item." };
  const checks: ScorecardCheck[] = [
    stageTimeCheck(input.daysInStage, input.limitDays),
    nextActionCheck(input.item.next_action, input.item.next_action_due, input.today),
    requiredCheck(input.stages, input.item.stage_id, input.values),
    activityCheck(input.lastActivity, input.today, input.stallDays),
  ];
  const onTrack = checks.filter((c) => c.color === "green").length;
  return { open: true, checks, overall: overallColor(checks), onTrack, total: checks.length, scoreText: `${onTrack} of ${checks.length} on track` };
}
