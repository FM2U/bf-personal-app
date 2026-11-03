import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGoogle } from "@/lib/google";
import { env, isAIConfigured } from "@/lib/env";
import { anthropicBaseUrl } from "@/lib/ai/claude";
import { todayInTz } from "@/lib/calc/dates";
import type { Row } from "@/lib/types";

/**
 * The scheduled jobs of the final app (2026-11-02). A problem becomes a to-do due today, so it shows on Home in
 * Next actions; nothing else is created. Reply reading (push B) and the monthly review row (push D) join here.
 */

const KEY_EXPIRY_INPUT = "anthropic_key_expiry_date";
const KEY_EXPIRY_WARNING_DAYS = 14;

export async function ownerIds(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from("owner_profile").select("owner_id");
  return ((data ?? []) as Row[]).map((r) => String(r.owner_id));
}

async function ownerToday(sb: SupabaseClient, ownerId: string): Promise<string> {
  const { data } = await sb.from("owner_profile").select("timezone").eq("owner_id", ownerId).maybeSingle();
  return todayInTz(String((data as Row | null)?.timezone || "America/New_York"));
}

/** Adds a to-do due today unless an open one with the same text exists. */
async function todoOnce(sb: SupabaseClient, ownerId: string, today: string, text: string) {
  const { data } = await sb.from("todos").select("id").eq("owner_id", ownerId).eq("text", text).is("done_at", null).limit(1);
  if (data?.length) return;
  await sb.from("todos").insert({ owner_id: ownerId, text, due_on: today });
}

/** Confirms the Anthropic API key is accepted. Listing models is free. */
async function checkAnthropicKey(): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!isAIConfigured()) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${anthropicBaseUrl()}/v1/models?limit=1`, { headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" }, cache: "no-store" });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `the key was rejected (HTTP ${res.status})` };
    return { ok: true, error: `Anthropic returned HTTP ${res.status}; not treated as a key problem` };
  } catch (e) {
    return { ok: true, error: `Anthropic could not be reached (${e instanceof Error ? e.message : String(e)}); not treated as a key problem` };
  }
}

/** Daily: the Google connection still works, the Anthropic key is accepted and not about to expire. */
export async function connectionChecks(sb: SupabaseClient, ownerId: string) {
  const today = await ownerToday(sb, ownerId);
  const g = await checkGoogle(sb, ownerId);
  if (!g.skipped) {
    await sb.from("google_connections").update({ status: g.ok ? "connected" : "error", last_checked_at: new Date().toISOString(), last_error: g.ok ? null : g.error ?? null }).eq("owner_id", ownerId);
    if (!g.ok) await todoOnce(sb, ownerId, today, "Reconnect Google in Settings (2 minutes)");
  }
  const key = await checkAnthropicKey();
  if (!key.skipped && !key.ok) await todoOnce(sb, ownerId, today, "Replace the Anthropic API key: Anthropic rejected it (5 minutes)");
  const { data: exp } = await sb.from("inputs").select("value_text").eq("owner_id", ownerId).eq("key", KEY_EXPIRY_INPUT).maybeSingle();
  const expiry = (exp as Row | null)?.value_text ? String((exp as Row).value_text) : null;
  let daysLeft: number | null = null;
  if (expiry) {
    daysLeft = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (Number.isFinite(daysLeft) && daysLeft <= KEY_EXPIRY_WARNING_DAYS) await todoOnce(sb, ownerId, today, `Replace the Anthropic API key before it expires on ${expiry} (5 minutes)`);
  }
  return { google: g, anthropic: key, keyExpiry: expiry ?? "not set", daysLeft };
}
