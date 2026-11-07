import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import type { Row } from "@/lib/types";
import { oncePerPage } from "@/lib/request-once";

/** The signed-in owner's context for a request: the client, the owner, today in the owner's time zone. */
export type Ctx = { sb: SupabaseClient; ownerId: string; today: string; tz: string; profile: Row };

export async function loadCtx(sb: SupabaseClient, ownerId: string): Promise<Ctx> {
  const { data } = await oncePerPage(`owner_profile:${ownerId}`, () => sb.from("owner_profile").select("*").eq("owner_id", ownerId).maybeSingle());
  const profile = (data as Row | null) ?? { timezone: "America/New_York" };
  const tz = profile.timezone || "America/New_York";
  return { sb, ownerId, today: todayInTz(tz), tz, profile };
}
