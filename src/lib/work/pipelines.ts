/**
 * The Job search and Consulting pages (batch B2, approved 2026-10-31), pure and tested in
 * src/lib/work/pipelines.test.ts. Job search reuses the Deals three-phase layout with two phases, Early (Contact,
 * Conversation) and Decide (Interview, Offer); its closed bar counts Declined, Not chosen, and Accepted. Consulting
 * shows its four open stages (Lead, Proposal, Engagement, Paid) as columns sized to content; its closed bar counts
 * Lost and Done. The stage rows live in the database (update 0022); these helpers read them by name.
 */
import type { PhaseDef } from "@/lib/work/phases";

export const JOB_STAGES = ["Contact", "Conversation", "Interview", "Offer"] as const;
/** Early: get a conversation. Decide: interview and decide. */
export const JOB_PHASES: readonly PhaseDef[] = [
  { key: "early", name: "Early", tagline: "Get a conversation", stages: ["Contact", "Conversation"] },
  { key: "decide", name: "Decide", tagline: "Interview and decide", stages: ["Interview", "Offer"] },
];

/** The closed stages of Job search, in the order of the closed bar. Declined is Bram's decision; Not chosen is theirs. */
export const JOB_CLOSED = [
  { name: "Declined", outcome: "lost", label: "Declined", tone: "charcoal" },
  { name: "Not chosen", outcome: "lost", label: "Not chosen", tone: "charcoal" },
  { name: "Accepted", outcome: "won", label: "Accepted", tone: "green" },
] as const;

export const CONSULTING_STAGES = ["Lead", "Proposal", "Engagement", "Paid"] as const;
type ConsultingStageName = (typeof CONSULTING_STAGES)[number];

/** One column per open stage, with the line under its name. */
export const CONSULTING_COLUMNS: readonly { name: ConsultingStageName; tagline: string }[] = [
  { name: "Lead", tagline: "Someone asked" },
  { name: "Proposal", tagline: "Scope and fee sent" },
  { name: "Engagement", tagline: "Work under way" },
  { name: "Paid", tagline: "Invoice paid" },
];

/** The closed stages of Consulting, in the order of the closed bar. Done means paid and wrapped up; Lost means the client chose someone else or dropped it. */
export const CONSULTING_CLOSED = [
  { name: "Lost", outcome: "lost", label: "Lost", tone: "charcoal" },
  { name: "Done", outcome: "won", label: "Done", tone: "green" },
] as const;

/** 0-based index of a stage in the four open stages of its pipeline, or -1 (closed, unknown). */
export function openStageIndex(kind: "job" | "consulting", name: string | null | undefined): number {
  const list: readonly string[] = kind === "job" ? JOB_STAGES : CONSULTING_STAGES;
  return list.indexOf(String(name ?? ""));
}

/** The next open stage after this one (Advance), or null at the last one or for a closed stage. */
export function nextOpenStage(kind: "job" | "consulting", name: string | null | undefined): string | null {
  const list: readonly string[] = kind === "job" ? JOB_STAGES : CONSULTING_STAGES;
  const i = list.indexOf(String(name ?? ""));
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

/** The closed bar's label: "Declined 3 · Not chosen 2 · Accepted 1" (a zero count is still shown for the first two; Accepted only when any). */
export function closedBarLabel(kind: "job" | "consulting", counts: Record<string, number>): string {
  const list = kind === "job" ? JOB_CLOSED : CONSULTING_CLOSED;
  return list
    .filter((c) => (c.name === "Accepted" ? (counts[c.name] ?? 0) > 0 : true))
    .map((c) => `${c.label} ${counts[c.name] ?? 0}`)
    .join(" · ");
}

/** "$18K", "$4.5K", "$12K est." for the fee figure on a consulting row (est. when the item is still a lead). */
export function feeLabel(fee: number | null | undefined, stageName: string | null | undefined): string {
  if (fee === null || fee === undefined || !Number.isFinite(Number(fee))) return "No fee yet";
  const n = Number(fee);
  const short = n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${Math.round(n)}`;
  return stageName === "Lead" ? `${short} est.` : short;
}

/** The one-line note on a row: the first line of the item's notes, at most 160 characters. */
export function noteLine(notes: unknown): string | null {
  const line = String(notes ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 160) : null;
}

export type ConsultingFilter = "all" | "today" | "week";

export const CONSULTING_FILTERS: readonly { key: ConsultingFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Due next 7 days" },
];

/** Due today: due today or earlier. Due next 7 days: due after today and within 7 days. */
export function matchesConsultingFilter(i: { status: string; nextAction: string | null; nextActionDue: string | null }, filter: ConsultingFilter, today: string, weekEnd: string): boolean {
  if (i.status !== "open") return false;
  if (filter === "all") return true;
  if (!i.nextAction || !i.nextActionDue) return false;
  const d = i.nextActionDue.slice(0, 10);
  if (filter === "today") return d <= today;
  return d > today && d <= weekEnd;
}

/** The "What to find out" lines of an opportunity (one group; stored as the "self" group of open_questions_json). */
export function findOutLines(groups: { seller: string[]; broker: string[]; self: string[] }): string[] {
  return [...groups.self, ...groups.seller, ...groups.broker];
}
