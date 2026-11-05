import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isGoogleConfigured } from "@/lib/env";
import { getGmailThread, getGoogleConnection } from "@/lib/google";
import { newReplies, shouldCheckReplies } from "@/lib/gmail-replies";
import { replyPermission, type SendPermission } from "@/lib/google-scopes";
import type { Row } from "@/lib/types";

/**
 * Reply reading (push B, 2026-11-03). Looks in the Gmail threads of what the app sent in the last 30 days (End of day
 * reports and emails sent from the app; their thread ids were stored at sending) and stores each new reply once as an
 * incoming communication on the person. A reply to a report is linked to that report and goes straight onto the
 * person's timeline; a reply to another email waits on the person page's Incoming card for "Log it". Nothing else in
 * the mailbox is read. Runs when Home, Reports, or a partner's page opens (at most once every few minutes) and every
 * morning (the morning job).
 */

export type ReplySync = { state: "ok" | "skipped" | "error" | Exclude<SendPermission, "allowed">; added: number; threads: number; error?: string };

const WINDOW_DAYS = 30;
const MAX_THREADS = 40;

type ThreadSource = { threadId: string; sentAt: string; contactId: string | null; organizationId: string | null; pipelineItemId: string | null; reportId: string | null };

/**
 * The threads to look in: partner reports first (they link the reply), then (push E2) the emails waits watch (the
 * email a wait came from and its follow-up, however old), then the other emails the app sent.
 */
async function threadSources(sb: SupabaseClient, ownerId: string, since: string): Promise<ThreadSource[]> {
  const { data: waitRows } = await sb.from("waits").select("comm_id,follow_up_comm_id").eq("owner_id", ownerId).limit(500);
  const waitedIds = [...new Set(((waitRows ?? []) as Row[]).flatMap((w) => [w.comm_id, w.follow_up_comm_id]).filter(Boolean).map(String))];
  const { data: waited } = waitedIds.length ? await sb.from("communications").select("id,contact_id,organization_id,pipeline_item_id,occurred_at,gmail_thread_id,partner_report_id").eq("owner_id", ownerId).in("id", waitedIds).not("gmail_thread_id", "is", null) : { data: [] as Row[] };
  const [{ data: reports }, { data: comms }] = await Promise.all([
    sb.from("partner_reports").select("id,contact_id,sent_at,gmail_thread_id").eq("owner_id", ownerId).not("gmail_thread_id", "is", null).gte("sent_at", since).order("sent_at", { ascending: false }).limit(MAX_THREADS),
    sb.from("communications").select("id,contact_id,organization_id,pipeline_item_id,occurred_at,gmail_thread_id,partner_report_id").eq("owner_id", ownerId).eq("direction", "outgoing").eq("method", "email").not("gmail_thread_id", "is", null).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(MAX_THREADS * 2),
  ]);
  const out = new Map<string, ThreadSource>();
  for (const r of (reports ?? []) as Row[]) {
    const t = String(r.gmail_thread_id);
    if (!out.has(t)) out.set(t, { threadId: t, sentAt: String(r.sent_at), contactId: r.contact_id ? String(r.contact_id) : null, organizationId: null, pipelineItemId: null, reportId: String(r.id) });
  }
  for (const c of [...((waited ?? []) as Row[]), ...((comms ?? []) as Row[])]) {
    const t = String(c.gmail_thread_id);
    const seen = out.get(t);
    // The earliest send in a thread is the one replies are newer than.
    if (seen) {
      if (String(c.occurred_at) < seen.sentAt && !seen.reportId) seen.sentAt = String(c.occurred_at);
      continue;
    }
    out.set(t, { threadId: t, sentAt: String(c.occurred_at), contactId: c.contact_id ? String(c.contact_id) : null, organizationId: c.organization_id ? String(c.organization_id) : null, pipelineItemId: c.pipeline_item_id ? String(c.pipeline_item_id) : null, reportId: c.partner_report_id ? String(c.partner_report_id) : null });
  }
  // Sample data's threads are not in Gmail.
  return [...out.values()].filter((s) => !s.threadId.startsWith("sample-")).slice(0, MAX_THREADS);
}

/** Looks for replies now (force) or when the last look is a few minutes old. Never throws. */
export async function syncReplies(sb: SupabaseClient, ownerId: string, opts: { force?: boolean; now?: Date } = {}): Promise<ReplySync> {
  const now = opts.now ?? new Date();
  try {
    if (!isGoogleConfigured()) return { state: "not_connected", added: 0, threads: 0 };
    const conn = await getGoogleConnection(sb, ownerId);
    const perm = replyPermission(conn);
    if (perm !== "allowed") return { state: perm, added: 0, threads: 0 };
    if (!opts.force && !shouldCheckReplies((conn?.replies_checked_at as string | null) ?? null, now)) return { state: "skipped", added: 0, threads: 0 };
    // Marked first, so two pages opening at once do not both look.
    await sb.from("google_connections").update({ replies_checked_at: now.toISOString() }).eq("owner_id", ownerId);
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    const sources = await threadSources(sb, ownerId, since);
    if (!sources.length) return { state: "ok", added: 0, threads: 0 };
    const { data: knownRows } = await sb.from("communications").select("gmail_message_id").eq("owner_id", ownerId).eq("direction", "incoming").in("gmail_thread_id", sources.map((s) => s.threadId)).limit(5000);
    const known = new Set(((knownRows ?? []) as Row[]).map((r) => String(r.gmail_message_id)));
    const contactIds = [...new Set(sources.map((s) => s.contactId).filter(Boolean))] as string[];
    const { data: people } = contactIds.length ? await sb.from("contacts").select("id,organization_id").in("id", contactIds) : { data: [] as Row[] };
    const orgOf = new Map(((people ?? []) as Row[]).map((p) => [String(p.id), p.organization_id ? String(p.organization_id) : null]));
    let added = 0;
    let failed = 0;
    let lastError: string | undefined;
    for (const s of sources) {
      let messages;
      try {
        messages = await getGmailThread(sb, ownerId, s.threadId);
      } catch (e) {
        const status = Number((e as { response?: { status?: unknown } })?.response?.status ?? NaN);
        const text = e instanceof Error ? e.message : String(e);
        if (status === 401 || status === 403 || /insufficient|invalid_grant/i.test(text)) return { state: "reconnect", added, threads: sources.length, error: text };
        failed++;
        lastError = text;
        continue;
      }
      if (!messages) return { state: "not_connected", added, threads: sources.length };
      const replies = newReplies(messages, { ownerEmail: (conn?.google_email as string | null) ?? null, sentAt: s.sentAt, known });
      for (const r of replies) {
        const row = {
          owner_id: ownerId,
          occurred_at: r.at,
          method: "email",
          direction: "incoming",
          contact_id: s.contactId,
          organization_id: s.organizationId ?? (s.contactId ? orgOf.get(s.contactId) ?? null : null),
          subject: (r.subject || "Reply").slice(0, 300),
          summary: r.text.slice(0, 2000) || null,
          is_outreach: false,
          purpose: "general",
          pipeline_item_id: s.pipelineItemId,
          gmail_message_id: r.id,
          gmail_thread_id: s.threadId,
          // A reply to a report goes onto the timeline; a reply to another email waits for Log it.
          awaiting_log: !s.reportId,
          partner_report_id: s.reportId,
        };
        const { error } = await sb.from("communications").insert(row);
        // 23505: already stored (another page stored it a moment ago).
        if (error && error.code !== "23505") {
          failed++;
          lastError = error.message;
          continue;
        }
        known.add(r.id);
        if (!error) added++;
      }
    }
    if (failed && failed >= sources.length) return { state: "error", added, threads: sources.length, error: lastError };
    return { state: "ok", added, threads: sources.length, ...(lastError ? { error: lastError } : {}) };
  } catch (e) {
    return { state: "error", added: 0, threads: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** For a page load: the same check, but it never holds the page longer than a few seconds. */
export async function syncRepliesQuietly(sb: SupabaseClient, ownerId: string, ms = 4000): Promise<ReplySync> {
  const timeout = new Promise<ReplySync>((resolve) => setTimeout(() => resolve({ state: "skipped", added: 0, threads: 0, error: "timed out" }), ms));
  return Promise.race([syncReplies(sb, ownerId), timeout]);
}
