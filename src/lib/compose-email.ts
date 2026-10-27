import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleConnection } from "@/lib/google";
import { sendPermission, type SendPermission } from "@/lib/google-scopes";
import { isGoogleConfigured } from "@/lib/env";
import { defaultPipelineRecipient, organizationRecipients, pipelineRecipients, type Recipient } from "@/lib/calc/compose-email";
import { isValidEmail } from "@/lib/email-address";
import type { Row } from "@/lib/types";

/** Tables whose record page shows the "Email" button. */
export const EMAIL_BUTTON_TABLES = new Set(["contacts", "organizations", "pipeline_items"]);

/** Google side of the compose box: Send now permission, the From address, and whether Gmail drafts can be saved. */
export type GmailSetup = { permission: SendPermission; fromEmail: string | null; canGmail: boolean };

/** Everything the compose box needs, loaded on the server (plain data, passed to the client component). */
export type ComposeSetup = GmailSetup & {
  /** "Email Pat Example" or "Email about Demo Car Wash Co". */
  title: string;
  recipients: Recipient[];
  defaultTo: string;
  /** The contact the email is logged to when the To address is not one of the listed people (contact page). */
  contactId: string | null;
  pipelineItemId: string | null;
  organizationId: string | null;
  /** Shown under To when nobody could be chosen for the owner. */
  toNote: string | null;
};

export async function loadGmailSetup(sb: SupabaseClient, ownerId: string): Promise<GmailSetup> {
  if (!isGoogleConfigured()) return { permission: "not_connected", fromEmail: null, canGmail: false };
  const google = await getGoogleConnection(sb, ownerId);
  return {
    permission: sendPermission(google),
    fromEmail: (google?.google_email as string | null) ?? null,
    canGmail: google?.status === "connected",
  };
}

/** The compose box setup for a contact, organization, or pipeline item page. */
export async function loadComposeSetup(sb: SupabaseClient, ownerId: string, table: string, row: Row): Promise<ComposeSetup | null> {
  if (!EMAIL_BUTTON_TABLES.has(table)) return null;
  const gmail = await loadGmailSetup(sb, ownerId);
  if (table === "contacts") {
    const valid = !!row.email && isValidEmail(String(row.email));
    return {
      ...gmail,
      title: `Email ${row.name}`,
      recipients: valid ? [{ contactId: row.id, name: row.name, email: String(row.email).trim(), role: "This contact" }] : [],
      defaultTo: valid ? String(row.email).trim() : "",
      contactId: row.id,
      pipelineItemId: null,
      organizationId: null,
      toNote: valid ? null : "This contact has no email address saved. Type one here, or add it with Edit.",
    };
  }
  if (table === "organizations") {
    const { data } = await sb.from("contacts").select("id,name,email").eq("organization_id", row.id).order("name");
    const { recipients, defaultTo } = organizationRecipients((data ?? []) as Row[] as { id: string; name: string; email: string }[]);
    return {
      ...gmail,
      title: `Email someone at ${row.name}`,
      recipients,
      defaultTo: defaultTo?.email ?? "",
      contactId: null,
      pipelineItemId: null,
      organizationId: row.id,
      toNote: recipients.length ? null : "No one at this organization has an email address saved. Type an address.",
    };
  }
  // Pipeline item: main contact first, then "Deal came from".
  const ids = [row.primary_contact_id, row.source_contact_id, row.introduced_by_contact_id].filter(Boolean) as string[];
  const [{ data: people }, { data: orgPeople }] = await Promise.all([
    ids.length ? sb.from("contacts").select("id,name,email").in("id", ids) : Promise.resolve({ data: [] as Row[] }),
    row.organization_id ? sb.from("contacts").select("id,name,email").eq("organization_id", row.organization_id).order("name") : Promise.resolve({ data: [] as Row[] }),
  ]);
  const byId = Object.fromEntries(((people ?? []) as Row[]).map((c) => [c.id, c]));
  const recipients = pipelineRecipients(row, byId, (orgPeople ?? []) as Row[] as { id: string }[]);
  const def = defaultPipelineRecipient(row, byId);
  return {
    ...gmail,
    title: `Email about ${row.name}`,
    recipients,
    defaultTo: def?.email ?? "",
    contactId: null,
    pipelineItemId: row.id,
    organizationId: (row.organization_id as string | null) ?? null,
    toNote: def ? null : recipients.length ? "Choose who this goes to." : "No main contact or Deal came from contact with an email address. Type an address.",
  };
}
