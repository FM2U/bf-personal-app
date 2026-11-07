import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import type { Row } from "@/lib/types";
import { keptSettings } from "@/lib/kept-settings";
import { oncePerPage } from "@/lib/request-once";
import { fromKept, setWorkWeek, workWeekFromProfile } from "@/lib/work-week";

/** The signed-in owner's context for a request: the client, the owner, today in the owner's time zone. */
export type Ctx = { sb: SupabaseClient; ownerId: string; today: string; tz: string; profile: Row };

export async function loadCtx(sb: SupabaseClient, ownerId: string): Promise<Ctx> {
  const profileP = oncePerPage(`owner_profile:${ownerId}`, () => sb.from("owner_profile").select("*").eq("owner_id", ownerId).maybeSingle());
  // Speed plan (2026-11-07): a page build starts at once with the settings kept in the browser; the profile is still
  // read in the same trip, and KeptSettingsCheck rebuilds the page if they differ (src/lib/kept-settings.ts).
  const kept = await keptSettings(ownerId);
  if (kept) {
    Promise.resolve(profileP).catch(() => {});
    // The work week (design B, 2026-11-07); a cookie kept before it existed has none, and KeptSettingsCheck rebuilds the page.
    setWorkWeek(fromKept(kept.ww));
    return { sb, ownerId, today: todayInTz(kept.tz), tz: kept.tz, profile: { owner_id: ownerId, timezone: kept.tz, display_name: kept.dn } };
  }
  const { data } = await profileP;
  const profile = (data as Row | null) ?? { timezone: "America/New_York" };
  const tz = profile.timezone || "America/New_York";
  setWorkWeek(workWeekFromProfile(profile));
  return { sb, ownerId, today: todayInTz(tz), tz, profile };
}
