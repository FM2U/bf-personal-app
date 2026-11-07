import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import type { LinkRecord } from "@/lib/work/link-picker";
import { homeLaterTodos, homeTodos, onTodoLists, todoSections, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import { loadLinkRecords, TASK_SELECT, withRecords } from "@/lib/work/tasks-data";
import type { Row } from "@/lib/types";
import { ownerRecordNames } from "@/lib/work/shared-reads";

function startRecordNames(sb: SupabaseClient, ownerId: string) {
  for (const p of Object.values(ownerRecordNames(sb, ownerId))) p.catch(() => {});
}

/**
 * The To-dos page (batch B; push C): personal to-dos and dated record tasks (one table, deal_todos), open and done
 * today, in their sections, plus every record the Link to picker can offer.
 */
export type TodosData = { today: string; sections: Record<TodoSectionKey, PersonalTodo[]>; total: number; records: LinkRecord[] };

/** Home's Next actions and Work through: the open items due today or earlier (personal and record tasks); none on an error. */
export async function loadHomeTodos(sb: SupabaseClient, ctx: Pick<Ctx, "ownerId" | "today">): Promise<PersonalTodo[]> {
  // Speed plan (2026-11-07): the record names start now, with the tasks (one trip).
  startRecordNames(sb, ctx.ownerId);
  const { data, error } = await sb.from("deal_todos").select(TASK_SELECT).eq("owner_id", ctx.ownerId).is("done_at", null).lte("due_on", ctx.today).limit(1000);
  if (error) return [];
  return homeTodos(await withRecords(sb, ctx.ownerId, (data ?? []) as Row[]), ctx.today);
}

/**
 * Home (fix list item 3, 2026-11-06): every open dated item in one read, split into due today or earlier (Next actions
 * and Work through) and due later (the Due later section, soonest first); both empty on an error.
 */
export async function loadHomeTodoLists(sb: SupabaseClient, ctx: Pick<Ctx, "ownerId" | "today">): Promise<{ due: PersonalTodo[]; later: PersonalTodo[] }> {
  // Speed plan (2026-11-07): the record names start now, with the tasks (one trip).
  startRecordNames(sb, ctx.ownerId);
  const { data, error } = await sb.from("deal_todos").select(TASK_SELECT).eq("owner_id", ctx.ownerId).is("done_at", null).not("due_on", "is", null).limit(2000);
  if (error) return { due: [], later: [] };
  const all = await withRecords(sb, ctx.ownerId, (data ?? []) as Row[]);
  return { due: homeTodos(all, ctx.today), later: homeLaterTodos(all, ctx.today) };
}

export async function loadTodos(sb: SupabaseClient, ctx: Ctx): Promise<TodosData> {
  // Speed plan (2026-11-07): the record names start now, with the tasks (one trip).
  startRecordNames(sb, ctx.ownerId);
  // Open items, plus items done in the last two days (the owner's "today" is decided below).
  const since = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const [{ data, error }, records] = await Promise.all([
    sb.from("deal_todos").select(TASK_SELECT).eq("owner_id", ctx.ownerId).or(`done_at.is.null,done_at.gte.${since}`).limit(3000),
    loadLinkRecords(sb, ctx.ownerId, ctx.today),
  ]);
  if (error) throw new Error(error.message);
  // Undated record tasks stay on their record; only personal to-dos and dated record tasks come here.
  const rows = ((data ?? []) as Row[]).filter((r) => !r.record_id || r.due_on);
  const todos = (await withRecords(sb, ctx.ownerId, rows)).filter(onTodoLists);
  const sections = todoSections(todos, ctx.today, (ts) => todayInTz(ctx.tz, new Date(ts)));
  return { today: ctx.today, sections, total: sections.today.length + sections.week.length + sections.later.length, records };
}
