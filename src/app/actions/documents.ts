"use server";
// Document actions for record pages (upload in two steps, delete). Moved from the old records actions on 2026-11-02.
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { documentPath, documentSizeError, DOCUMENT_KINDS, isDocumentPathFor } from "@/lib/documents";

type PanelResult = { ok: true } | { ok: false; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The records that can hold documents. */
const LINKABLE = new Set(["pipeline_items", "contacts", "organizations", "projects"]);
/** Inside a drawer, __quiet skips revalidation (the drawer reloads itself). */
const settle = (fd: FormData | null) => {
  if (!fd || fd.get("__quiet") !== "1") revalidatePath("/", "layout");
};

type UploadTarget = { recordType: string; recordId: string };

/**
 * Step 1 of an upload (Documents card): checks the file and makes a signed upload address in the owner's folder of
 * the documents bucket. The browser then sends the file straight to Supabase Storage (uploadToSignedUrl), so the file
 * never passes through a server action (1 MB limit) or a Vercel function (about 4.5 MB). The storage rules of
 * migration 0007 apply: the signed-in owner (aal2) may add files only under their own folder.
 */
export async function startDocumentUpload(input: UploadTarget & { fileName: string; size: number }): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const tooBig = documentSizeError(Number(input.size) || 0);
  if (tooBig) return { ok: false, error: tooBig };
  if (!LINKABLE.has(input.recordType) || !UUID_RE.test(input.recordId)) return { ok: false, error: "Documents cannot be added to this record." };
  const { supabase, ownerId } = await requireOwner();
  const path = documentPath(ownerId, input.recordType, input.recordId, String(input.fileName ?? "file"), Date.now());
  const { data, error } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: `The upload could not start: ${error?.message ?? "no upload address was returned"}. Try again.` };
  return { ok: true, path, token: data.token };
}

/** Step 2 of an upload: the file is in storage; save the document record that shows it on the record page. */
export async function saveDocumentRecord(input: UploadTarget & { path: string; fileName: string; size: number; mimeType: string; kind: string; quiet?: boolean }): Promise<PanelResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!isDocumentPathFor(input.path, ownerId, input.recordType, input.recordId)) return { ok: false, error: "The uploaded file could not be matched to this record. Upload it again." };
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(input.kind) ? input.kind : "other";
  const { error } = await supabase.from("documents").insert({
    owner_id: ownerId,
    record_type: input.recordType,
    record_id: input.recordId,
    storage_path: input.path,
    file_name: String(input.fileName).slice(0, 300),
    mime_type: input.mimeType || null,
    size_bytes: Number(input.size) || null,
    kind,
    description: null,
  });
  if (error) {
    // The record was not saved: remove the file so nothing is left in storage without a record.
    await supabase.storage.from("documents").remove([input.path]);
    return { ok: false, error: `The file was uploaded, but its record was not saved: ${error.message}. Upload it again.` };
  }
  if (!input.quiet) revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteDocument(fd: FormData): Promise<PanelResult> {
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("documents").select("storage_path").eq("id", String(fd.get("id"))).maybeSingle();
  const { error } = await supabase.from("documents").delete().eq("id", String(fd.get("id")));
  if (error) return { ok: false, error: `The document was not deleted: ${error.message}` };
  if (data?.storage_path) await supabase.storage.from("documents").remove([data.storage_path]);
  settle(fd);
  return { ok: true };
}

