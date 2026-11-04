import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import type { LinkRecord } from "@/lib/work/link-picker";
import { homeTodos, onTodoLists, todoSections, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import { loadLinkRecords, TASK_SELECT, withRecords } from "@/lib/work/tasks-data";
import type { Row } from "@/lib/types";

/**
 * The To-dos page (batch B; push C): personal to-dos and dated record tasks (one table, deal_todos), open and done
 * today, in their sections, plus every record the Link to picker can offer.
 */
export type TodosData = { today: string; sections: Record<TodoSectionKey, PersonalTodo[]>; total: number; records: LinkRecord[] };

/** Home's Next actions and Work through: the open items due today or earlier (personal and record tasks); none on an error. */
export async function loadHomeTodos(sb: SupabaseClient, ctx: Pick<Ctx, "ownerId" | "today">): Promise<PersonalTodo[]> {
  const { data, error } = await sb.from("deal_todos").select(TASK_SELECT).eq("owner_id", ctx.ownerId).is("done_at", null).lte("due_on", ctx.today).limit(1000);
  if (error) return [];
  return homeTodos(await withRecords(sb, ctx.ownerId, (data ?? []) as Row[]), ctx.today);
}

export async function loadTodos(sb: SupabaseClient, ctx: Ctx): Promise<TodosData> {
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
