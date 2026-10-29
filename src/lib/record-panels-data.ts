import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResource, recordHref, RESOURCES } from "@/lib/resources";
import { titleOf } from "@/lib/data";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

/**
 * Data for the right-panel cards of a record (Linked records, Documents, Notes, Change history). The record page
 * (src/components/app/record-panels.tsx) and the task window (loadTaskWindow in src/app/actions/window.ts) both use
 * these, and both show them with the same cards (src/components/app/record-side-panels.tsx). Dates are formatted
 * here, on the server, as the page always did.
 */

export type LinkedItem = { id: string; type: string; rid: string; typeLabel: string; relation: string | null; title: string; href: string };
export type LinkCandidates = { t: string; label: string; rows: { id: string; label: string }[] }[];
export type LinkedData = { links: LinkedItem[]; candidates: LinkCandidates };
export type DocumentItem = { id: string; fileName: string; kind: string; when: string };
export type NoteItem = { id: string; body: string; when: string };
export type HistoryItem = { id: string; when: string; actor: "ai" | "system" | "owner"; field: string | null; text: string };

const LINK_TARGET_TABLES = [
  "contacts", "organizations", "pipeline_items", "initiatives", "goals", "milestones", "decisions", "tasks", "debts",
  "funding_sources", "accounts", "partners", "communications", "income_sources", "scenarios", "reduction_actions",
];

export async function loadLinked(sb: SupabaseClient, table: string, id: string): Promise<LinkedData> {
  const [{ data: out }, { data: inc }] = await Promise.all([
    sb.from("record_links").select("*").eq("from_type", table).eq("from_id", id),
    sb.from("record_links").select("*").eq("to_type", table).eq("to_id", id),
  ]);
  const raw = [
    ...((out ?? []) as Row[]).map((l) => ({ id: l.id, type: l.to_type, rid: l.to_id, relation: l.relation })),
    ...((inc ?? []) as Row[]).map((l) => ({ id: l.id, type: l.from_type, rid: l.from_id, relation: l.relation })),
  ];
  const byType: Record<string, string[]> = {};
  for (const l of raw) (byType[l.type] ??= []).push(l.rid);
  const titles: Record<string, string> = {};
  await Promise.all(
    Object.entries(byType).map(async ([t, ids]) => {
      if (!RESOURCES[t] && t !== "documents") return;
      const { data } = await sb.from(t).select("*").in("id", ids);
      for (const r of (data ?? []) as Row[]) titles[`${t}:${r.id}`] = titleOf(t, r);
    }),
  );
  const candidates = await Promise.all(
    LINK_TARGET_TABLES.filter((t) => t !== table).map(async (t) => {
      const r = RESOURCES[t];
      const { data } = await sb.from(t).select("*").order(r.order[0], { ascending: r.order[1] }).limit(100);
      return { t, label: r.plural, rows: ((data ?? []) as Row[]).map((x) => ({ id: String(x.id), label: titleOf(t, x) })) };
    }),
  );
  return {
    links: raw.map((l) => ({
      id: String(l.id),
      type: String(l.type),
      rid: String(l.rid),
      typeLabel: getResource(l.type)?.singular ?? String(l.type),
      relation: l.relation ?? null,
      title: titles[`${l.type}:${l.rid}`] ?? "Open record",
      href: recordHref(l.type, l.rid),
    })),
    candidates: candidates.filter((c) => c.rows.length),
  };
}

export async function loadDocuments(sb: SupabaseClient, table: string, id: string): Promise<DocumentItem[]> {
  const { data } = await sb.from("documents").select("*").eq("record_type", table).eq("record_id", id).order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map((d) => ({ id: String(d.id), fileName: String(d.file_name), kind: String(d.kind ?? "other").replace(/_/g, " "), when: dateTime(d.created_at) }));
}

export async function loadNotes(sb: SupabaseClient, table: string, id: string): Promise<NoteItem[]> {
  const { data } = await sb.from("notes").select("*").eq("record_type", table).eq("record_id", id).order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map((n) => ({ id: String(n.id), body: String(n.body ?? ""), when: dateTime(n.created_at) }));
}

/** Change history lines, with field names and referenced records shown as text. */
export async function loadHistory(sb: SupabaseClient, table: string, id: string, labels: Record<string, Record<string, string>> = {}): Promise<HistoryItem[]> {
  const { data } = await sb.from("change_log").select("*").eq("table_name", table).eq("record_id", id).order("created_at", { ascending: false }).limit(25);
  const r = getResource(table);
  const rows = ((data ?? []) as Row[]).filter((c) => c.action !== "update" || !r || r.fields.some((f) => f.name === c.field));
  const showRaw = (v: unknown) => (v === null || v === undefined ? "empty" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80));
  const show = (v: unknown, field?: string) => {
    const f = r?.fields.find((x) => x.name === field);
    if (f?.type === "ref" && typeof v === "string") return labels[f.ref!]?.[v] ?? "another record";
    if (f?.type === "select" && v !== null && v !== undefined) return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    return showRaw(v);
  };
  return rows.map((c) => ({
    id: String(c.id),
    when: dateTime(c.created_at),
    actor: c.actor === "ai" ? "ai" : c.actor === "system" ? "system" : "owner",
    field: c.action === "update" ? r?.fields.find((f) => f.name === c.field)?.label ?? String(c.field) : null,
    text:
      c.action === "update"
        ? `${show(c.old_value, c.field)} to ${show(c.new_value, c.field)}`
        : c.field === "email_sent"
          ? `Email sent from the app to ${showRaw((c.new_value as Row | null)?.to)}`
          : c.action === "insert"
            ? "Created"
            : "Deleted",
  }));
}
