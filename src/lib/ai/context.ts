/**
 * "Ask AI about this": the page or record the chat was opened from, written as plain text for the AI's system prompt
 * (record type, key fields, next action, linked records, open tasks, recent activity). The AI still reads more with
 * its tools and still only proposes changes. `formatRecordContext` is pure (tested in src/lib/ai/context.test.ts);
 * `loadAiContext` reads the database (server only, called from src/app/api/ai/chat/route.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResource, SECRET_COLUMNS, type Field } from "@/lib/resources";
import type { Row } from "@/lib/types";

/** What the chat sends with each message when it was opened with "Ask AI about this". */
export type ChatContext = { table?: string; id?: string; label: string; path?: string };

const ID = /^[0-9a-f-]{36}$/i;

/** Keeps only safe values from the browser: a known record type, an id, and short text. */
export function cleanChatContext(raw: unknown): ChatContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = String(r.label ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const table = typeof r.table === "string" && /^[a-z_]+$/.test(r.table) && getResource(r.table) ? r.table : undefined;
  const id = typeof r.id === "string" && ID.test(r.id) ? r.id : undefined;
  const path = typeof r.path === "string" && r.path.startsWith("/") ? r.path.slice(0, 300) : undefined;
  if (!label && !table) return null;
  return { label: label || "this record", ...(table && id ? { table, id } : {}), ...(path ? { path } : {}) };
}

export type RecordContext = {
  singular: string;
  table: string;
  id: string;
  title: string;
  fields: { label: string; value: string }[];
  next: { text: string; due?: string | null } | null;
  linked: { type: string; title: string }[];
  tasks: { title: string; due: string | null }[];
  activity: { date: string; text: string }[];
};

const MAX = 6000;

/** The record as plain text for the AI. Empty values are left out; the text is held to about 6,000 characters. */
export function formatRecordContext(c: RecordContext): string {
  const lines: string[] = [];
  lines.push(`Bram pressed "Ask AI about this" on the ${c.singular.toLowerCase()} "${c.title}" (table "${c.table}", id "${c.id}"). Questions like "this deal" or "this" mean this record.`);
  if (c.next) lines.push(`Next required action: ${c.next.text}${c.next.due ? ` (due ${c.next.due})` : ""}`);
  if (c.fields.length) lines.push("Fields:", ...c.fields.map((f) => `- ${f.label}: ${f.value}`));
  if (c.linked.length) lines.push("Linked records:", ...c.linked.slice(0, 12).map((l) => `- ${l.type}: ${l.title}`));
  if (c.tasks.length) lines.push("Open tasks:", ...c.tasks.slice(0, 10).map((t) => `- ${t.title}${t.due ? ` (due ${t.due})` : ""}`));
  if (c.activity.length) lines.push("Recent activity:", ...c.activity.slice(0, 5).map((a) => `- ${a.date}: ${a.text}`));
  lines.push("Use get_record or list_records for anything else. Any change is a proposal Bram approves.");
  const text = lines.join("\n");
  return text.length > MAX ? `${text.slice(0, MAX)}\n(cut short)` : text;
}

/** A page (no record): its name and address. */
export function formatPageContext(c: ChatContext): string {
  return `Bram pressed "Ask AI about this" on the page "${c.label}"${c.path ? ` (${c.path})` : ""}. Questions like "this" mean what this page shows. Read the data with the tools before answering.`;
}

function show(f: Field, v: unknown, refTitles: Record<string, string>): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.map((x) => f.options?.find((o) => o.value === String(x))?.label ?? String(x)).join(", ") : null;
  if (f.type === "ref") return refTitles[String(v)] ?? null;
  if (f.type === "boolean") return v ? "Yes" : "No";
  if (f.type === "money") return `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (f.type === "percent") return `${v}%`;
  if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (f.type === "json") return null;
  const s = String(v);
  return s.length > 600 ? `${s.slice(0, 600)}...` : s;
}

async function titlesFor(sb: SupabaseClient, table: string, ids: string[]): Promise<Record<string, string>> {
  const r = getResource(table);
  if (!r || !ids.length) return {};
  const { data } = await sb.from(table).select("*").in("id", ids.slice(0, 20));
  const { titleOf } = await import("@/lib/data");
  return Object.fromEntries(((data ?? []) as Row[]).map((row) => [row.id, titleOf(table, row)]));
}

/** Reads the record and what is around it. When it cannot be read, the page name and address are used instead. */
export async function loadAiContext(sb: SupabaseClient, c: ChatContext, today: string): Promise<string> {
  if (!c.table || !c.id) return formatPageContext(c);
  const r = getResource(c.table);
  if (!r || ["google_connections", "plaid_items", "partner_links", "ai_messages"].includes(c.table)) return formatPageContext(c);
  const { data: row } = await sb.from(c.table).select("*").eq("id", c.id).maybeSingle();
  if (!row) return formatPageContext(c);
  const { titleOf } = await import("@/lib/data");
  const { nextActionFor } = await import("@/lib/next-action");
  // Titles of the referenced records (organization, stage, contacts, initiative...).
  const refIds: Record<string, string[]> = {};
  for (const f of r.fields) if (f.type === "ref" && f.ref && row[f.name]) (refIds[f.ref] ??= []).push(String(row[f.name]));
  const refTitles: Record<string, string> = {};
  for (const [t, ids] of Object.entries(refIds)) Object.assign(refTitles, await titlesFor(sb, t, ids));
  const fields = r.fields
    .filter((f) => !SECRET_COLUMNS.includes(f.name))
    .map((f) => ({ label: f.label, value: show(f, (row as Row)[f.name], refTitles) }))
    .filter((f): f is { label: string; value: string } => f.value !== null);
  const id = c.id;
  const [{ data: l1 }, { data: l2 }, { data: tasks }, { data: comms }, next] = await Promise.all([
    sb.from("record_links").select("to_type,to_id").eq("from_type", c.table).eq("from_id", id).limit(15),
    sb.from("record_links").select("from_type,from_id").eq("to_type", c.table).eq("to_id", id).limit(15),
    sb.from("tasks").select("title,due_date").eq("status", "todo").or(`related_id.eq.${id},pipeline_item_id.eq.${id},goal_id.eq.${id},milestone_id.eq.${id},initiative_id.eq.${id}`).order("due_date").limit(10),
    ["contacts", "organizations", "pipeline_items"].includes(c.table)
      ? sb.from("communications").select("occurred_at,method,subject,summary").or(`contact_id.eq.${id},organization_id.eq.${id},pipeline_item_id.eq.${id}`).order("occurred_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
    nextActionFor(sb, c.table, row as Row, today).catch(() => null),
  ]);
  const links = [...((l1 ?? []) as Row[]).map((l) => ({ t: String(l.to_type), id: String(l.to_id) })), ...((l2 ?? []) as Row[]).map((l) => ({ t: String(l.from_type), id: String(l.from_id) }))];
  const byTable: Record<string, string[]> = {};
  for (const l of links) if (getResource(l.t)) (byTable[l.t] ??= []).push(l.id);
  const linked: RecordContext["linked"] = [];
  for (const [t, ids] of Object.entries(byTable)) {
    const titles = await titlesFor(sb, t, ids);
    for (const lid of ids) if (titles[lid]) linked.push({ type: getResource(t)!.singular, title: titles[lid] });
  }
  return formatRecordContext({
    singular: r.singular,
    table: c.table,
    id,
    title: titleOf(c.table, row as Row) || c.label,
    fields,
    next: next ? { text: next.text, due: next.due ?? null } : null,
    linked,
    tasks: ((tasks ?? []) as Row[]).map((t) => ({ title: String(t.title), due: t.due_date ?? null })),
    activity: ((comms ?? []) as Row[]).map((m) => ({ date: String(m.occurred_at ?? "").slice(0, 10), text: [m.method, m.subject, m.summary].filter(Boolean).join(": ").slice(0, 240) })),
  });
}
