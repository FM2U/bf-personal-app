/**
 * The Deals screen's three phase columns (approved 2026-10-30) and its filters, pure and tested in
 * src/lib/work/phases.test.ts. The phases hold the nine working stages in order: Early two, Evaluate four, Decide
 * three (Broker call moved to Evaluate after CIM review in Edit batch B, 2026-11-01). The filters run in the browser
 * over the deals the page already loaded.
 */
import type { WorkStageName } from "@/lib/work/stages";

type PhaseKey = "early" | "evaluate" | "decide";

type Phase = { key: PhaseKey; name: string; tagline: string; stages: readonly WorkStageName[] };

/** A phase of any pipeline (the Job search page reuses the columns with its own two phases; batch B2). */
export type PhaseDef = { key: string; name: string; tagline: string; stages: readonly string[] };

/** Early: get the CIM. Evaluate: decide whether to bid. Decide: bid and close. */
export const PHASES: readonly Phase[] = [
  { key: "early", name: "Early", tagline: "Get the CIM", stages: ["Interested", "NDA signed"] },
  { key: "evaluate", name: "Evaluate", tagline: "Decide whether to bid", stages: ["CIM review", "Broker call", "Seller call", "Model"] },
  { key: "decide", name: "Decide", tagline: "Bid and close", stages: ["Partner presentation", "IOI or LOI", "Diligence"] },
] as const;

/** Groups the stage groups (the nine, in order) under their phase; a stage not in any phase is left out. Another pipeline passes its own phases. */
export function groupByPhase<G extends { stage: { name: string }; deals: unknown[] }, P extends PhaseDef = Phase>(groups: readonly G[], phases: readonly P[] = PHASES as unknown as readonly P[]): { phase: P; groups: G[]; count: number }[] {
  return phases.map((phase) => {
    const own = phase.stages.map((name) => groups.find((g) => g.stage.name === name)).filter((g): g is G => !!g);
    return { phase, groups: own, count: own.reduce((s, g) => s + g.deals.length, 0) };
  });
}

/** "4 deals", "1 deal", "No deals" (or "3 open", "1 open", "None open" for the Job search columns). */
export function dealsLabel(n: number, noun: "deal" | "open" = "deal"): string {
  if (noun === "open") return n === 0 ? "None open" : `${n} open`;
  return n === 0 ? "No deals" : `${n} ${n === 1 ? "deal" : "deals"}`;
}

export type DealFilter = "all" | "today" | "wait" | "needs";

export const DEAL_FILTERS: readonly { key: DealFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Due today" },
  { key: "wait", label: "Waiting on someone" },
  { key: "needs", label: "Needs a next action" },
];

/** What the filters read on a deal (a subset of DealRow, so the tests stay small). */
export type FilterableDeal = { name: string; status: string; nextAction: string | null; nextActionDue: string | null; waitLevel: string };

/** Due today: an open deal whose next action is due today or earlier. */
function isDueToday(d: FilterableDeal, today: string): boolean {
  return d.status === "open" && !!d.nextAction && !!d.nextActionDue && d.nextActionDue.slice(0, 10) <= today;
}

/** Waiting on someone: an open deal with a wait (any color). */
function isWaiting(d: FilterableDeal): boolean {
  return d.status === "open" && d.waitLevel !== "none";
}

/** Needs a next action: an open deal with no next action. */
function needsNextAction(d: FilterableDeal): boolean {
  return d.status === "open" && !String(d.nextAction ?? "").trim();
}

export function matchesFilter(d: FilterableDeal, filter: DealFilter, today: string): boolean {
  if (filter === "today") return isDueToday(d, today);
  if (filter === "wait") return isWaiting(d);
  if (filter === "needs") return needsNextAction(d);
  return true;
}

/** "Find a deal": the name holds the typed text, any letter case; an empty box matches everything. Other pages add more text to search (the role, the contact). */
export function matchesSearch(d: FilterableDeal & { searchText?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || d.name.toLowerCase().includes(q) || String(d.searchText ?? "").toLowerCase().includes(q);
}

/** The counts on the filter pills. */
export function filterCounts(deals: readonly FilterableDeal[], today: string): Record<DealFilter, number> {
  const open = deals.filter((d) => d.status === "open");
  return {
    all: open.length,
    today: open.filter((d) => isDueToday(d, today)).length,
    wait: open.filter(isWaiting).length,
    needs: open.filter(needsNextAction).length,
  };
}

/** The filter named in a page address (?filter=wait, from Deals at a glance on Home); anything else is All. */
export function parseDealFilter(value: unknown): DealFilter {
  return typeof value === "string" && DEAL_FILTERS.some((f) => f.key === value) ? (value as DealFilter) : "all";
}
