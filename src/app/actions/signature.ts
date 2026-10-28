"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { fetchGmailSignature, getGoogleConnection } from "@/lib/google";
import { signaturePermission } from "@/lib/google-scopes";
import { explainGoogleError } from "@/lib/google-errors";
import { isGoogleConfigured } from "@/lib/env";
import { isMissingSchemaError, DB_UPDATE_NOTICE_0015 } from "@/lib/schema-guard";
import { sanitizeSignatureHtml, signatureHtmlToText, SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";

export type CopyResult = { ok: true; html: string; text: string; message: string } | { ok: false; reason: "reconnect" | "not_connected" | "google"; message: string; googleText?: string | null };

/** Copy from Gmail / Refresh from Gmail: reads the signature into the editor. Nothing is saved until Save signature. */
export async function copySignatureFromGmail(): Promise<CopyResult> {
  const { supabase, ownerId } = await requireOwner();
  const perm = isGoogleConfigured() ? signaturePermission(await getGoogleConnection(supabase, ownerId)) : "not_connected";
  if (perm === "not_connected") return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections first." };
  if (perm === "reconnect") return { ok: false, reason: "reconnect", message: "Reconnect Google to use your Gmail signature (1 minute), then press Copy from Gmail again." };
  try {
    const sig = await fetchGmailSignature(supabase, ownerId);
    if (!sig) return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections first." };
    if (!sig.html) return { ok: false, reason: "google", message: `Gmail has no signature${sig.address ? ` for ${sig.address}` : ""}. Add one in Gmail, Settings, Signature, or type it here.` };
    return { ok: true, html: sig.html, text: sig.text, message: `Copied from Gmail${sig.address ? ` (${sig.address})` : ""}. Check the preview, then press Save signature.` };
  } catch (e) {
    const x = explainGoogleError(e);
    if (x.kind === "reconnect" || x.kind === "no_permission") return { ok: false, reason: "reconnect", message: "Google did not allow the app to read your signature. Reconnect Google to use your Gmail signature (1 minute).", googleText: x.googleText };
    return { ok: false, reason: "google", message: "The signature could not be read from Gmail. Try again in a minute.", googleText: x.googleText };
  }
}

export type SaveSignatureResult = { ok: boolean; message: string; html?: string; text?: string };

/** Save signature: stores the sanitized HTML, its plain text, and the setting. An empty box removes the signature. */
export async function saveEmailSignature(input: { html: string; enabled: boolean }): Promise<SaveSignatureResult> {
  const { supabase, ownerId } = await requireOwner();
  const raw = String(input.html ?? "");
  if (raw.length > SIGNATURE_MAX_LENGTH) return { ok: false, message: `The signature is too long (${raw.length.toLocaleString("en-US")} characters). The limit is ${SIGNATURE_MAX_LENGTH.toLocaleString("en-US")}.` };
  const html = sanitizeSignatureHtml(raw);
  const text = html ? signatureHtmlToText(html) : "";
  const { error } = await supabase
    .from("owner_profile")
    .update({ email_signature_html: html || null, email_signature_text: text || null, email_signature_enabled: !!input.enabled, email_signature_updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId);
  if (error) return { ok: false, message: isMissingSchemaError(error) ? DB_UPDATE_NOTICE_0015 : `The signature was not saved. ${error.message}` };
  revalidatePath("/", "layout");
  return { ok: true, message: html ? "Signature saved." : "Signature removed. Emails are sent without a signature.", html, text };
}
