"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { runEvening, runMorning, plaidSyncAll } from "@/lib/engine/run";
import { loadCtx } from "@/lib/engine/helpers";
import { oauthClient } from "@/lib/google";
import { decrypt } from "@/lib/crypto";

export async function disconnectGoogle() {
  const { supabase, ownerId } = await requireOwner();
  const { data } = await supabase.from("google_connections").select("refresh_token_enc").eq("owner_id", ownerId).maybeSingle();
  if (data?.refresh_token_enc) {
    try {
      await oauthClient().revokeToken(decrypt(data.refresh_token_enc));
    } catch {
      // The token may already be invalid; the saved copy is removed either way.
    }
  }
  await supabase.from("google_connections").update({ status: "disconnected", refresh_token_enc: null, last_error: null }).eq("owner_id", ownerId);
  revalidatePath("/", "layout");
}

export async function saveProfile(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const tz = String(fd.get("timezone") ?? "America/New_York");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error("Time zone not recognized. Example: America/New_York");
  }
  await supabase
    .from("owner_profile")
    .update({
      display_name: String(fd.get("display_name") ?? "") || null,
      timezone: tz,
      morning_hour: Number(fd.get("morning_hour") ?? 7),
      evening_hour: Number(fd.get("evening_hour") ?? 20),
      weekly_review_weekday: Number(fd.get("weekly_review_weekday") ?? 0),
    })
    .eq("owner_id", ownerId);
  revalidatePath("/", "layout");
}

/** Runs the scheduled morning job now (same steps as the daily cron). */
export async function runMorningNow() {
  const { supabase, ownerId } = await requireOwner();
  await runMorning(supabase, ownerId);
  revalidatePath("/", "layout");
}

export async function runEveningNow() {
  const { supabase, ownerId } = await requireOwner();
  await runEvening(supabase, ownerId);
  revalidatePath("/", "layout");
}

export async function plaidSyncNow() {
  const { supabase, ownerId } = await requireOwner();
  await plaidSyncAll(await loadCtx(supabase, ownerId));
  revalidatePath("/", "layout");
}

export async function disconnectPlaidItem(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("plaid_items").update({ status: "disconnected" }).eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}
