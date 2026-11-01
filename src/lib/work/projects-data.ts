import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { compareProjects, rosaraTile } from "@/lib/work/projects";
import type { TimelineEvent } from "@/lib/work/timeline";
import { openTodos, sortTodos, topTodo, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * What the Rosara page, the project page, and the Rosara tile on Home read (batch B2, database updates 0022 and
 * 0023). A project is a row of the projects table with one next action; its tasks are deal_todos rows with
 * record_type projects; its timeline is the notes on it (a note with kind finding carries a source link) and the
 * calls logged on it. The weekly focus is the setting rosara_weekly_focus. Nothing here writes; the actions are in
 * src/app/actions/projects.ts.
 */

/** One project as the Rosara rows, the Home rows and tile, and the project page show it. Plain data for client components. */
export type ProjectRow = {
  id: string;
  name: string;
  goal: string | null;
  milestone: string | null;
  status: string;
  closedAt: string | null;
  nextAction: string | null;
  /** YYYY-MM-DD or null. */
  nextActionDue: string | null;
  nextActionMinutes: number | null;
  /** Open tasks (the TASKS figure). */
  openTasks: number;
  /** The first open task (offered as the next action when the current one is Done). */
  topTask: { id: string; text: string } | null;
  createdAt: string;
};

const PROJECT_COLUMNS = "id,name,goal,milestone,status,closed_at,next_action,next_action_due,next_action_minutes,position,created_at";
const TASK_COLUMNS = "id,record_type,record_id,text,position,done_at,created_at";

function toTask(t: Row): DealTodo {
  return { id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") };
}

export function toProjectRow(p: Row, tasks: readonly DealTodo[] = []): ProjectRow {
  const top = topTodo(tasks);
  return {
    id: String(p.id),
    name: String(p.name ?? ""),
    goal: p.goal ? String(p.goal) : null,
    milestone: p.milestone ? String(p.milestone) : null,
    status: String(p.status ?? "open"),
    closedAt: p.closed_at ? String(p.closed_at) : null,
    nextAction: p.next_action ? String(p.next_action) : null,
    nextActionDue: p.next_action_due ? String(p.next_action_due).slice(0, 10) : null,
    nextActionMinutes: p.next_action_minutes === null || p.next_action_minutes === undefined ? null : Number(p.next_action_minutes),
    openTasks: openTodos(tasks).length,
    topTask: top ? { id: top.id, text: top.text } : null,
    createdAt: String(p.created_at ?? ""),
  };
}

/** The weekly focus (the setting rosara_weekly_focus, text), or "" when not set. */
export async function loadWeeklyFocus(sb: SupabaseClient, ownerId: string): Promise<string> {
  const { data } = await sb.from("inputs").select("value_text").eq("owner_id", ownerId).eq("key", "rosara_weekly_focus").maybeSingle();
  return String((data as Row | null)?.value_text ?? "").trim();
}

/** Every project of the owner with its tasks counted (open and closed). */
export async function loadProjects(sb: SupabaseClient, ownerId: string): Promise<ProjectRow[]> {
  const { data, error } = await sb.from("projects").select(PROJECT_COLUMNS).eq("owner_id", ownerId).order("position").order("created_at").limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => String(r.id));
  const { data: tasks } = ids.length ? await sb.from("deal_todos").select(TASK_COLUMNS).eq("owner_id", ownerId).eq("record_type", "projects").in("record_id", ids).limit(5000) : { data: [] as Row[] };
  const byProject: Record<string, DealTodo[]> = {};
  for (const t of (tasks ?? []) as Row[]) (byProject[String(t.record_id)] ??= []).push(toTask(t));
  return rows.map((r) => toProjectRow(r, byProject[String(r.id)] ?? []));
}

export type RosaraData = { today: string; focus: string; projects: ProjectRow[] };

/** The Rosara page: the weekly focus and every project. */
export async function loadRosara(sb: SupabaseClient, ctx: Ctx): Promise<RosaraData> {
  const [focus, projects] = await Promise.all([loadWeeklyFocus(sb, ctx.ownerId), loadProjects(sb, ctx.ownerId)]);
  return { today: ctx.today, focus, projects };
}

/** The Rosara tile on Home and the project rows on Next actions. */
export type RosaraHome = {
  focus: string;
  /** The next project action (the soonest due). */
  next: ProjectRow | null;
  open: number;
  dueThisWeek: number;
  /** Open projects with a next action due today or earlier, or with none (the rows on Next actions). */
  actions: ProjectRow[];
};

export async function loadRosaraHome(sb: SupabaseClient, ctx: Ctx): Promise<RosaraHome> {
  const [focus, projects] = await Promise.all([loadWeeklyFocus(sb, ctx.ownerId), loadProjects(sb, ctx.ownerId)]);
  const tile = rosaraTile(projects, ctx.today, addDaysISO(ctx.today, 7));
  const open = projects.filter((p) => p.status === "open");
  return {
    focus,
    next: tile.next,
    open: tile.open,
    dueThisWeek: tile.dueThisWeek,
    actions: open.filter((p) => !p.nextAction || (p.nextActionDue && p.nextActionDue <= ctx.today)).sort(compareProjects),
  };
}

export type ProjectPageData = {
  today: string;
  tz: string;
  project: ProjectRow | null;
  tasks: DealTodo[];
  /** Notes and findings (newest first); a finding carries its source link in `href`. */
  timeline: TimelineEvent[];
};

/** The project page: the project, its tasks, and its timeline (notes and findings, calls logged on it). */
export async function loadProjectPage(sb: SupabaseClient, ctx: Ctx, id: string): Promise<ProjectPageData> {
  const base: ProjectPageData = { today: ctx.today, tz: ctx.tz, project: null, tasks: [], timeline: [] };
  const { data: row } = await sb.from("projects").select(PROJECT_COLUMNS).eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  const p = row as Row | null;
  if (!p) return base;
  const [{ data: taskRows }, { data: notes }] = await Promise.all([
    sb.from("deal_todos").select(TASK_COLUMNS).eq("owner_id", ctx.ownerId).eq("record_type", "projects").eq("record_id", id).limit(500),
    sb.from("notes").select("id,body,kind,source_url,created_at").eq("record_type", "projects").eq("record_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const tasks = sortTodos(((taskRows ?? []) as Row[]).map(toTask));
  const timeline: TimelineEvent[] = ((notes ?? []) as Row[]).map((n) => {
    const body = String(n.body ?? "");
    const finding = n.kind === "finding";
    const [first, ...rest] = body.split("\n");
    return {
      id: `note:${n.id}`,
      kind: finding ? ("finding" as const) : ("note" as const),
      when: String(n.created_at),
      date: fmtDate(String(n.created_at), "MMM d"),
      title: finding ? first.slice(0, 200) : "Note",
      detail: (finding ? rest.join(" ").trim() : body.slice(0, 400)) || null,
      href: finding && n.source_url ? String(n.source_url) : null,
    };
  });
  return { ...base, project: toProjectRow(p, tasks), tasks, timeline };
}
