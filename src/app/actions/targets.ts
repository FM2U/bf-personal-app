"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { AI_SYSTEM_MESSAGE, AIUnavailable, callClaude, cleanText, parseJsonFromText, textOf } from "@/lib/ai/claude";
import { createGmailDraft, getGoogleConnection } from "@/lib/google";
import { markdownToPlain } from "@/lib/markdown";
import { DB_UPDATE_NOTICE, isMissingSchemaError } from "@/lib/schema-guard";
import { GROUP_LABELS, OUTCOME_LABELS, type RelationshipGroup } from "@/lib/calc/outreach";
import { isGoogleConfigured } from "@/lib/env";
import type { Row } from "@/lib/types";

const OUTREACH_METHODS = ["email", "call", "text", "meeting", "other"];
const OUTCOMES = Object.keys(OUTCOME_LABELS);

function back(fd: FormData, notice: string, fallback = "/accountability/targets"): never {
  const path = String(fd.get("back") ?? "") || fallback;
  const clean = path.replace(/([?&])notice=[^&]*/g, "$1").replace(/[?&]$/, "");
  const sep = clean.includes("?") ? "&" : "?";
  redirect(`${clean}${sep}notice=${encodeURIComponent(notice)}`);
}

/** +1 on a target that is counted manually. */
export async function addTargetEntry(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const count = Math.max(1, Math.min(1000, Number(fd.get("count") ?? 1) || 1));
  const { error } = await supabase.from("target_entries").insert({
    owner_id: ownerId,
    target_id: String(fd.get("target_id")),
    entry_date: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("entry_date") ?? "")) ? String(fd.get("entry_date")) : ctx.today,
    count,
    note: String(fd.get("note") ?? "").trim() || null,
  });
  if (error) back(fd, isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}`);
  await evaluateConditions(ctx);
  revalidatePath("/", "layout");
}

/** Removes the latest manual count entered today for a target (undo for +1). */
export async function undoTargetEntry(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const { data } = await supabase
    .from("target_entries")
    .select("id")
    .eq("target_id", String(fd.get("target_id")))
    .eq("entry_date", ctx.today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) await supabase.from("target_entries").delete().eq("id", data.id);
  revalidatePath("/", "layout");
}

/** Saves the one-line reason for a missed target period (daily close or the Targets tab). */
export async function saveTargetMissReason(fd: FormData) {
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) back(fd, "A one-line reason is required.");
  const { supabase, ownerId } = await requireOwner();
  const { error } = await supabase.from("target_misses").upsert(
    {
      owner_id: ownerId,
      target_id: String(fd.get("target_id")),
      period_start: String(fd.get("period_start")),
      period_end: String(fd.get("period_end") ?? fd.get("period_start")),
      actual_count: Number(fd.get("actual_count") ?? 0) || 0,
      required_count: Number(fd.get("required_count") ?? 0) || 0,
      reason: reason.slice(0, 200),
    },
    { onConflict: "target_id,period_start" },
  );
  if (error) back(fd, isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}`);
  revalidatePath("/", "layout");
  back(fd, "Reason saved.");
}

/** Logs outreach: one communication with is_outreach = true, linked to the contact. Nothing is sent. */
export async function logOutreach(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const contactId = String(fd.get("contact_id") ?? "") || null;
  const method = OUTREACH_METHODS.includes(String(fd.get("method"))) ? String(fd.get("method")) : "email";
  const outcomeRaw = String(fd.get("outcome") ?? "");
  const outcome = OUTCOMES.includes(outcomeRaw) ? outcomeRaw : null;
  const summary = String(fd.get("summary") ?? "").trim().slice(0, 2000) || null;
  let contact: Row | null = null;
  if (contactId) contact = ((await supabase.from("contacts").select("id,name,organization_id").eq("id", contactId).maybeSingle()).data as Row | null) ?? null;
  const methodLabel = method === "other" ? "Outreach" : `Outreach ${method}`;
  const { error } = await supabase.from("communications").insert({
    owner_id: ownerId,
    occurred_at: new Date().toISOString(),
    method,
    direction: "outgoing",
    contact_id: contact?.id ?? null,
    organization_id: contact?.organization_id ?? null,
    subject: contact ? `${methodLabel}: ${contact.name}` : methodLabel,
    summary,
    is_outreach: true,
    outcome,
  });
  if (error) back(fd, isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}`, "/people/outreach");
  await evaluateConditions(ctx);
  revalidatePath("/", "layout");
  back(fd, contact ? `Outreach to ${contact.name} logged.` : "Outreach logged.", "/people/outreach");
}

/** Records the outcome of an outreach communication later (for example when a reply arrives). */
export async function setOutreachOutcome(fd: FormData) {
  const { supabase } = await requireOwner();
  const raw = String(fd.get("outcome") ?? "");
  const { error } = await supabase
    .from("communications")
    .update({ outcome: OUTCOMES.includes(raw) ? raw : null, is_outreach: true })
    .eq("id", String(fd.get("id")));
  if (error) back(fd, isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}`, "/people/outreach");
  revalidatePath("/", "layout");
}

export type DraftResult =
  | { ok: true; subject: string; body: string; source: "ai" | "template"; note?: string; canGmail: boolean; email: string | null }
  | { ok: false; error: string };

/** Drafts a short outreach message for a contact. Shown for approval; never sent automatically. */
export async function draftOutreachMessage(contactId: string): Promise<DraftResult> {
  const { supabase, ownerId } = await requireOwner();
  const { data: c } = await supabase.from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!c) return { ok: false, error: "Contact not found." };
  const [{ data: org }, { data: comms }, google] = await Promise.all([
    c.organization_id ? supabase.from("organizations").select("name,kind").eq("id", c.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("communications").select("occurred_at,method,direction,subject,summary").eq("contact_id", contactId).order("occurred_at", { ascending: false }).limit(5),
    getGoogleConnection(supabase, ownerId),
  ]);
  const canGmail = !!c.email && isGoogleConfigured() && google?.status === "connected";
  const first = String(c.name ?? "").split(/\s+/)[0] || "there";
  const context = {
    name: c.name,
    title: c.title,
    organization: (org as Row | null)?.name ?? null,
    relationship_group: c.relationship_group ? GROUP_LABELS[c.relationship_group as RelationshipGroup] : null,
    roles: c.roles,
    notes: c.notes,
    recent_communications: ((comms ?? []) as Row[]).map((m) => ({ date: String(m.occurred_at).slice(0, 10), method: m.method, direction: m.direction, subject: m.subject, summary: m.summary })),
  };
  try {
    const msg = await callClaude({
      sb: supabase,
      ownerId,
      purpose: "outreach_draft",
      system: AI_SYSTEM_MESSAGE,
      messages: [
        {
          role: "user",
          content: `Draft a short outreach message (under 110 words) from Bram to ${c.name} to stay in touch. Mention one specific thing from the recent communications or notes when there is one. End with one simple, low-effort question or ask. Return only JSON: {"subject": "short subject line", "body": "message text, starting with a greeting using the first name"}. Contact (JSON): ${JSON.stringify(context).slice(0, 6000)}`,
        },
      ],
      maxTokens: 600,
    });
    const parsed = parseJsonFromText<{ subject?: string; body?: string }>(textOf(msg));
    if (!parsed?.body) return { ok: false, error: "The AI reply could not be read. Try again." };
    return { ok: true, subject: cleanText(String(parsed.subject ?? `Checking in`)), body: cleanText(String(parsed.body)), source: "ai", canGmail, email: c.email ?? null };
  } catch (e) {
    const note = e instanceof AIUnavailable ? e.message : "The AI request failed.";
    return {
      ok: true,
      subject: "Checking in",
      body: `Hi ${first},\n\nIt has been a while since we last talked, and I wanted to check in.\n\n- What are you working on these days?\n- Is there anything I can help with?\n\nWould you have 20 minutes for a call in the next two weeks?\n\nBest,\nBram`,
      source: "template",
      note: `${note} A plain template is shown instead.`,
      canGmail,
      email: c.email ?? null,
    };
  }
}

/** After approval: creates a Gmail draft (Bram presses send in Gmail). Never sends. */
export async function createOutreachGmailDraft(contactId: string, subject: string, body: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, ownerId } = await requireOwner();
  const { data: c } = await supabase.from("contacts").select("name,email").eq("id", contactId).maybeSingle();
  if (!c?.email) return { ok: false, message: "This contact has no email address. Copy the message instead." };
  try {
    const id = await createGmailDraft(supabase, ownerId, { to: c.email, subject: cleanText(subject).slice(0, 200), body: markdownToPlain(cleanText(body)) });
    if (!id) return { ok: false, message: "Google is not connected. Copy the message instead, or connect Google in Settings." };
    return { ok: true, message: `Gmail draft created for ${c.name}. Open Gmail to review and send it. After sending, press Log outreach.` };
  } catch (e) {
    return { ok: false, message: `The Gmail draft could not be created: ${e instanceof Error ? e.message : String(e)}` };
  }
}
