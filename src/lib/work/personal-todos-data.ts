import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import { todoSections, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import type { Row } from "@/lib/types";

/** The To-dos page (batch B, table todos): the open items and the ones done today, in their sections. */
export type TodosData = { today: string; sections: Record<TodoSectionKey, PersonalTodo[]>; total: number };

export function toPersonalTodo(t: Row): PersonalTodo {
  return { id: String(t.id), text: String(t.text ?? ""), dueOn: t.due_on ? String(t.due_on).slice(0, 10) : null, doneAt: t.done_at ? String(t.done_at) : null, position: Number(t.position ?? 0), createdAt: String(t.created_at ?? "") };
}

export async function loadTodos(sb: SupabaseClient, ctx: Ctx): Promise<TodosData> {
  // Open items, plus items done in the last two days (the owner's "today" is decided below).
  const since = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const { data, error } = await sb.from("todos").select("id,text,due_on,done_at,position,created_at").eq("owner_id", ctx.ownerId).or(`done_at.is.null,done_at.gte.${since}`).limit(1000);
  if (error) throw new Error(error.message);
  const todos = ((data ?? []) as Row[]).map(toPersonalTodo);
  const sections = todoSections(todos, ctx.today, (ts) => todayInTz(ctx.tz, new Date(ts)));
  return { today: ctx.today, sections, total: sections.today.length + sections.week.length + sections.later.length };
}
