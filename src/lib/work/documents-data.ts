import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export type DocumentItem = { id: string; fileName: string; kind: string; when: string };

/** The documents saved on one record, newest first. */
export async function loadDocuments(sb: SupabaseClient, table: string, id: string): Promise<DocumentItem[]> {
  const { data } = await sb.from("documents").select("*").eq("record_type", table).eq("record_id", id).order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map((d) => ({ id: String(d.id), fileName: String(d.file_name), kind: String(d.kind ?? "other").replace(/_/g, " "), when: dateTime(d.created_at) }));
}
