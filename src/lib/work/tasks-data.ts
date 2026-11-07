import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkRecord } from "@/lib/work/link-picker";
import { displayName } from "@/lib/work/names";
import { roleLabel } from "@/lib/work/outreach";
import { orgKindLabel } from "@/lib/work/people";
import type { PersonalTodo } from "@/lib/work/personal-todos";
import { parseRepeat } from "@/lib/work/repeat";
import { pipelineItemKind, type TaskRecord } from "@/lib/work/task-records";
import type { Row } from "@/lib/types";
import { ownerRecordNames, pick } from "@/lib/work/shared-reads";

/**
 * Push C (merge approved 2026-11-03): personal to-dos and record tasks are rows of one table, deal_todos. A row with
 * no record is a personal to-do. This module reads the rows with their record (name, kind, closed) for To-dos, Home
 * and Work through, and lists every record the Link to picker can offer.
 */
/** Every column ("*"): push D adds the Repeat end date, and a page keeps working before the database update adds it. */
export const TASK_SELECT = "*";

const recordKey = (type: unknown, id: unknown) => `${String(type)}:${String(id)}`;

/** The records named by task rows, by "record_type:record_id". Missing records are left out. */
export async function resolveTaskRecords(sb: SupabaseClient, ownerId: string, rows: readonly Row[]): Promise<Map<string, TaskRecord>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.record_type === type && r.record_id).map((r) => String(r.record_id)))];
  const items = ids("pipeline_items");
  const people = ids("contacts");
  const orgs = ids("organizations");
  const projects = ids("projects");
  const none = Promise.resolve({ data: [] as Row[] });
  // Speed plan (2026-11-07): the names come from the owner-wide reads a page starts with its tasks (shared-reads.ts),
  // so they arrive in the same trip. A record those reads do not hold (past their limit) is read by its id, as before.
  const shared = ownerRecordNames(sb, ownerId);
  const fill = async (list: string[], have: Promise<{ data: Row[] | null }>, byId: (missing: string[]) => PromiseLike<{ data: unknown }>) => {
    if (!list.length) return { data: [] as Row[] };
    const found = pick((await have).data, "id", list);
    const got = new Set(found.map((r) => String(r.id)));
    const missing = list.filter((id) => !got.has(id));
    if (!missing.length) return { data: found };
    const { data } = await byId(missing);
    return { data: [...found, ...((data ?? []) as Row[])] };
  };
  const [it, pp, og, pj, pipes] = await Promise.all([
    fill(items, shared.items, (m) => sb.from("pipeline_items").select("id,name,company_name,status,screened,pipeline_id").eq("owner_id", ownerId).in("id", m)),
    fill(people, shared.people, (m) => sb.from("contacts").select("id,name,archived_at").eq("owner_id", ownerId).in("id", m)),
    fill(orgs, shared.orgs, (m) => sb.from("organizations").select("id,name,archived_at").eq("owner_id", ownerId).in("id", m)),
    fill(projects, shared.projects, (m) => sb.from("projects").select("id,name,status").eq("owner_id", ownerId).in("id", m)),
    items.length ? shared.pipes : none,
  ]);
  const kindOf = new Map(((pipes.data ?? []) as Row[]).map((p) => [String(p.id), String(p.kind)]));
  const out = new Map<string, TaskRecord>();
  for (const i of (it.data ?? []) as Row[]) out.set(recordKey("pipeline_items", i.id), { kind: pipelineItemKind(kindOf.get(String(i.pipeline_id)), i.screened as boolean | null), id: String(i.id), name: displayName({ name: String(i.name ?? ""), companyName: i.company_name as string | null }), closed: String(i.status ?? "open") !== "open" });
  for (const c of (pp.data ?? []) as Row[]) out.set(recordKey("contacts", c.id), { kind: "person", id: String(c.id), name: String(c.name ?? ""), closed: !!c.archived_at });
  for (const o of (og.data ?? []) as Row[]) out.set(recordKey("organizations", o.id), { kind: "organization", id: String(o.id), name: String(o.name ?? ""), closed: !!o.archived_at });
  for (const p of (pj.data ?? []) as Row[]) out.set(recordKey("projects", p.id), { kind: "project", id: String(p.id), name: String(p.name ?? ""), closed: String(p.status ?? "open") !== "open" });
  return out;
}

export function toPersonalTodo(t: Row, records: ReadonlyMap<string, TaskRecord>): PersonalTodo {
  return {
    id: String(t.id),
    text: String(t.text ?? ""),
    dueOn: t.due_on ? String(t.due_on).slice(0, 10) : null,
    doneAt: t.done_at ? String(t.done_at) : null,
    position: Number(t.position ?? 0),
    createdAt: String(t.created_at ?? ""),
    repeat: parseRepeat(t.repeat),
    repeatUntil: parseRepeat(t.repeat) && t.repeat_until ? String(t.repeat_until).slice(0, 10) : null,
    record: t.record_id ? (records.get(recordKey(t.record_type, t.record_id)) ?? null) : null,
  };
}

/** Task rows with their records; a row whose record is gone is left out (it belongs to nothing that shows). */
export async function withRecords(sb: SupabaseClient, ownerId: string, rows: readonly Row[]): Promise<PersonalTodo[]> {
  const records = await resolveTaskRecords(sb, ownerId, rows);
  return rows.filter((r) => !r.record_id || records.has(recordKey(r.record_type, r.record_id))).map((r) => toPersonalTodo(r, records));
}

/**
 * Every record the Link to picker can offer, with its short status (the stage, the role, or the kind), whether it is
 * closed, and whether it has a next action or follow-up due today or earlier (today's records).
 */
export async function loadLinkRecords(sb: SupabaseClient, ownerId: string, today: string): Promise<LinkRecord[]> {
  const [it, st, pipes, pp, og, pj] = await Promise.all([
    sb.from("pipeline_items").select("id,name,company_name,status,screened,pipeline_id,stage_id,next_action,next_action_due").eq("owner_id", ownerId).limit(3000),
    sb.from("pipeline_stages").select("id,name").eq("owner_id", ownerId),
    sb.from("pipelines").select("id,kind").eq("owner_id", ownerId),
    sb.from("contacts").select("id,name,outreach_role,archived_at,follow_up_date").eq("owner_id", ownerId).limit(3000),
    sb.from("organizations").select("id,name,kind,archived_at,next_action_due").eq("owner_id", ownerId).limit(2000),
    sb.from("projects").select("id,name,status,milestone,next_action,next_action_due").eq("owner_id", ownerId).limit(1000),
  ]);
  const stageName = new Map(((st.data ?? []) as Row[]).map((s) => [String(s.id), String(s.name)]));
  const kindOf = new Map(((pipes.data ?? []) as Row[]).map((p) => [String(p.id), String(p.kind)]));
  const due = (d: unknown) => !!d && String(d).slice(0, 10) <= today;
  const out: LinkRecord[] = [];
  for (const i of (it.data ?? []) as Row[]) {
    const kind = pipelineItemKind(kindOf.get(String(i.pipeline_id)), i.screened as boolean | null);
    const open = String(i.status ?? "open") === "open";
    out.push({ kind, id: String(i.id), name: displayName({ name: String(i.name ?? ""), companyName: i.company_name as string | null }), status: kind === "listing" ? "Listing" : (stageName.get(String(i.stage_id)) ?? (open ? "Open" : "Closed")), closed: !open, dueToday: open && !!String(i.next_action ?? "").trim() && due(i.next_action_due) });
  }
  for (const c of (pp.data ?? []) as Row[]) out.push({ kind: "person", id: String(c.id), name: String(c.name ?? ""), status: roleLabel(c.outreach_role as string | null) ?? "Person", closed: !!c.archived_at, dueToday: !c.archived_at && due(c.follow_up_date) });
  for (const o of (og.data ?? []) as Row[]) out.push({ kind: "organization", id: String(o.id), name: String(o.name ?? ""), status: orgKindLabel(o.kind), closed: !!o.archived_at, dueToday: !o.archived_at && due(o.next_action_due) });
  for (const p of (pj.data ?? []) as Row[]) {
    const open = String(p.status ?? "open") === "open";
    out.push({ kind: "project", id: String(p.id), name: String(p.name ?? ""), status: open ? "Rosara project" : "Closed", closed: !open, dueToday: open && !!String(p.next_action ?? "").trim() && due(p.next_action_due) });
  }
  return out.filter((r) => r.name.trim());
}
