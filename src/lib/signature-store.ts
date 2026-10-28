import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { signatureHtmlToText, signatureOn, type SignatureSetup } from "@/lib/email-signature";

/** The saved signature columns on owner_profile (database update 0015). */
export type SignatureRow = {
  /** False before update 0015: the columns do not exist yet (sending works, without a signature). */
  available: boolean;
  html: string;
  text: string;
  /** The setting as saved (null: never changed, which means on once a signature exists). */
  enabled: boolean | null;
  updatedAt: string | null;
};

export async function readSignatureRow(sb: SupabaseClient, ownerId: string): Promise<SignatureRow> {
  const { data, error } = await sb
    .from("owner_profile")
    .select("email_signature_html,email_signature_text,email_signature_enabled,email_signature_updated_at")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) return { available: !isMissingSchemaError(error), html: "", text: "", enabled: null, updatedAt: null };
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    available: true,
    html: String(row.email_signature_html ?? ""),
    text: String(row.email_signature_text ?? ""),
    enabled: typeof row.email_signature_enabled === "boolean" ? row.email_signature_enabled : null,
    updatedAt: (row.email_signature_updated_at as string | null) ?? null,
  };
}

/** The saved signature for compose boxes and sending; null when there is none (or before update 0015). */
export async function loadSignature(sb: SupabaseClient, ownerId: string): Promise<SignatureSetup | null> {
  const row = await readSignatureRow(sb, ownerId);
  if (!row.available || !row.html.trim()) return null;
  return { html: row.html, text: row.text.trim() ? row.text : signatureHtmlToText(row.html), on: signatureOn(row.enabled, row.html) };
}
