/**
 * Home (Work on now) as the bento of mockup v6 (approved 2026-10-31), pure and tested in src/lib/work/home.test.ts:
 * the sections of the Next actions card (Overdue, Due today, Needs a next action), the sections of Waiting on someone
 * (at or past the threshold, and less than it), the filter pills (the same four as Deals, counted over the rows on the page), and
 * the Deals at a glance counts. The filters run in the browser over the deals the page already loaded.
 */
import { groupByPhase, type FilterableDeal } from "@/lib/work/phases";

export type HomeRow = FilterableDeal & { id: string; waitDays: number; stageName: string | null };

type WaitSectionKey = "over" | "under";

/** "5+ days" (at or past the threshold: a deal waiting exactly 5 days is here) and "< 5 days", for the Waiting on someone card. */
export function waitSections<T extends HomeRow>(deals: readonly T[], threshold: number): { key: WaitSectionKey; label: string; deals: T[] }[] {
  const t = Math.max(1, Math.round(threshold));
  const waiting = deals.filter((d) => d.status === "open" && d.waitLevel !== "none");
  return [
    { key: "over", label: `${t}+ days`, deals: waiting.filter((d) => d.waitDays >= t) },
    { key: "under", label: `< ${t} days`, deals: waiting.filter((d) => d.waitDays < t) },
  ];
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
