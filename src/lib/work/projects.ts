/**
 * Rosara projects (batch B2, approved 2026-10-31, decisions on v4 and v5), pure and tested in
 * src/lib/work/projects.test.ts: the sections of the Projects card (Due today, Active, No next action, Closed), the
 * filter pills, Find, the counts, and the Rosara tile on Home. A project is a row of the projects table (database
 * update 0022) with one next action (text, due date, minutes) that shows on Home with a Rosara lane pill; its tasks
 * are rows of deal_todos with record_type projects.
 */

/** What the sections, filters, and rows read on a project (a subset of the loaded row, so the tests stay small). */
export type ProjectLike = {
  id: string;
  name: string;
  milestone?: string | null;
  status: string;
  nextAction: string | null;
  /** YYYY-MM-DD or null. */
  nextActionDue: string | null;
  closedAt?: string | null;
};

type ProjectSectionKey = "today" | "active" | "needs" | "closed";

export const PROJECT_SECTIONS: readonly { key: ProjectSectionKey; label: string; hint?: string; collapsed?: boolean }[] = [
  { key: "today", label: "Due today" },
  { key: "active", label: "Active" },
  { key: "needs", label: "No next action", hint: "Set one or the project stalls" },
  { key: "closed", label: "Closed", collapsed: true },
];

/**
 * Which section a project sits in: Closed when closed; Due today when its next action is due today or earlier;
 * No next action when it has none; Active otherwise (a next action due later, or one without a date).
 */
function projectSectionOf(p: ProjectLike, today: string): ProjectSectionKey {
  if (p.status === "closed") return "closed";
  if (!String(p.nextAction ?? "").trim()) return "needs";
  if (p.nextActionDue && p.nextActionDue.slice(0, 10) <= today) return "today";
  return "active";
}

/** Within a section: soonest next due first, a project without a date last, then by name; Closed: newest close first. */
export function compareProjects(a: ProjectLike, b: ProjectLike): number {
  if (a.status === "closed" && b.status === "closed") {
    const ca = a.closedAt ?? "";
    const cb = b.closedAt ?? "";
    if (ca !== cb) return ca < cb ? 1 : -1;
  }
  const da = a.nextActionDue ?? "9999-99-99";
  const db = b.nextActionDue ?? "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** The four sections, each sorted. */
export function projectSections<T extends ProjectLike>(projects: readonly T[], today: string): Record<ProjectSectionKey, T[]> {
  const out: Record<ProjectSectionKey, T[]> = { today: [], active: [], needs: [], closed: [] };
  for (const p of projects) out[projectSectionOf(p, today)].push(p);
  for (const k of Object.keys(out) as ProjectSectionKey[]) out[k].sort(compareProjects);
  return out;
}

export type ProjectFilter = "all" | "today" | "needs" | "closed";

export const PROJECT_FILTERS: readonly { key: ProjectFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Due today" },
  { key: "needs", label: "Needs a next action" },
  { key: "closed", label: "Closed" },
];

/** All counts the open projects; Closed the closed ones. */
export function matchesProjectFilter(p: ProjectLike, filter: ProjectFilter, today: string): boolean {
  const section = projectSectionOf(p, today);
  if (filter === "all") return section !== "closed";
  if (filter === "closed") return section === "closed";
  return section === filter;
}

/** "Find a project": the name or the milestone holds the typed text, any letter case; an empty box matches everything. */
export function matchesProjectSearch(p: Pick<ProjectLike, "name" | "milestone">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || p.name.toLowerCase().includes(q) || String(p.milestone ?? "").toLowerCase().includes(q);
}

export function projectFilterCounts(projects: readonly ProjectLike[], today: string): Record<ProjectFilter, number> {
  const out = {} as Record<ProjectFilter, number>;
  for (const f of PROJECT_FILTERS) out[f.key] = projects.filter((p) => matchesProjectFilter(p, f.key, today)).length;
  return out;
}

/** "5 tasks", "1 task", "No tasks" is not used on the rows (the figure is a number); this is the Tasks card hint. */
export function projectTasksLabel(open: number): string {
  return open === 0 ? "No open tasks" : `${open} open ${open === 1 ? "task" : "tasks"}`;
}

/**
 * The Rosara tile on Home: the next project action (the soonest due among the open projects with one; a project
 * without a due date comes after dated ones), the open project count, and how many are due this week (today to the
 * end of the next 7 days, overdue included).
 */
export function rosaraTile<T extends ProjectLike>(projects: readonly T[], weekEnd: string): { next: T | null; open: number; dueThisWeek: number } {
  const open = projects.filter((p) => p.status !== "closed");
  const withAction = open.filter((p) => String(p.nextAction ?? "").trim()).sort(compareProjects);
  return {
    next: withAction[0] ?? null,
    open: open.length,
    dueThisWeek: withAction.filter((p) => !!p.nextActionDue && p.nextActionDue.slice(0, 10) <= weekEnd).length,
  };
}

/** "2 due this week", "1 due this week", "Nothing due this week". */
export function dueThisWeekLabel(n: number): string {
  return n === 0 ? "Nothing due this week" : `${n} due this week`;
}
