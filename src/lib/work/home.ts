/**
 * Home (Work on now) as the bento of mockup v6 (approved 2026-10-31), pure and tested in src/lib/work/home.test.ts:
 * the sections of the Next actions card (Overdue, Due today, Needs a next action), the sections of Waiting on someone
 * (over and under the threshold), the filter pills (the same four as Deals, counted over the rows on the page), and
 * the Deals at a glance counts. The filters run in the browser over the deals the page already loaded.
 */
import { groupByPhase, matchesFilter, matchesSearch, type DealFilter, type FilterableDeal } from "@/lib/work/phases";

export type HomeRow = FilterableDeal & { id: string; waitDays: number; stageName: string | null };

export type HomeSectionKey = "overdue" | "today" | "needs";

export const HOME_SECTIONS: readonly { key: HomeSectionKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "needs", label: "Needs a next action" },
];

/** Overdue: due before today. Due today: due today. Needs a next action: no action set. Each list keeps the order given. */
export function nextActionSections<T extends HomeRow>(deals: readonly T[], today: string): Record<HomeSectionKey, T[]> {
  const open = deals.filter((d) => d.status === "open");
  return {
    overdue: open.filter((d) => !!d.nextAction && !!d.nextActionDue && d.nextActionDue.slice(0, 10) < today),
    today: open.filter((d) => !!d.nextAction && !!d.nextActionDue && d.nextActionDue.slice(0, 10) === today),
    needs: open.filter((d) => !String(d.nextAction ?? "").trim()),
  };
}

export type WaitSectionKey = "over" | "under";

/** "Over 5 days" (at or past the threshold) and "Under 5 days", for the Waiting on someone card. */
export function waitSections<T extends HomeRow>(deals: readonly T[], threshold: number): { key: WaitSectionKey; label: string; deals: T[] }[] {
  const t = Math.max(1, Math.round(threshold));
  const waiting = deals.filter((d) => d.status === "open" && d.waitLevel !== "none");
  return [
    { key: "over", label: `Over ${t} days`, deals: waiting.filter((d) => d.waitDays >= t) },
    { key: "under", label: `Under ${t} days`, deals: waiting.filter((d) => d.waitDays < t) },
  ];
}

/** One row on the page (a deal can be in Next actions and in Waiting on someone at the same time). */
export type HomeRowRef = { card: "actions" | "waiting"; deal: HomeRow };

/** The filter pill counts, over the rows on the page (a deal in both cards counts twice, as the mockup does). */
export function homeFilterCounts(rows: readonly HomeRowRef[], today: string): Record<DealFilter, number> {
  const count = (f: DealFilter) => rows.filter((r) => matchesFilter(r.deal, f, today)).length;
  return { all: rows.length, today: count("today"), wait: count("wait"), needs: count("needs") };
}

/** Whether a row stays visible under the filter and the Find box. */
export function homeRowShown(deal: HomeRow, filter: DealFilter, query: string, today: string): boolean {
  return matchesFilter(deal, filter, today) && matchesSearch(deal, query);
}

export type GlanceCounts = { active: number; early: number; evaluate: number; decide: number; waitingOver: number; needsAction: number };

/** Deals at a glance: the active count, one per phase, waiting over the threshold, and needs a next action. */
export function glanceCounts(groups: readonly { stage: { name: string }; deals: readonly { status: string; nextAction: string | null; waitLevel: string }[] }[]): GlanceCounts {
  const phased = groupByPhase(groups.map((g) => ({ stage: g.stage, deals: [...g.deals] })));
  const all = groups.flatMap((g) => g.deals).filter((d) => d.status === "open");
  return {
    active: all.length,
    early: phased[0]?.count ?? 0,
    evaluate: phased[1]?.count ?? 0,
    decide: phased[2]?.count ?? 0,
    waitingOver: all.filter((d) => d.waitLevel === "amber" || d.waitLevel === "red").length,
    needsAction: all.filter((d) => !String(d.nextAction ?? "").trim()).length,
  };
}
