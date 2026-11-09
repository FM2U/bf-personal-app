import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { encodeKept, keptCookieRaw, keptSettings, type KeptSettings } from "@/lib/kept-settings";
import { oncePerPage } from "@/lib/request-once";
import { readPipelineRow, readWorkInputs, workInputs } from "@/lib/work/data";
import type { Row } from "@/lib/types";
import { keepWorkWeek, workWeekFromProfile } from "@/lib/work-week";
import { KeptSettingsSync } from "@/components/app/kept-settings-sync";

/**
 * After a page is sent (speed plan, 2026-11-07): the settings the page read fresh in its trip, compared with the ones
 * kept in the browser (src/lib/kept-settings.ts). The browser keeps the fresh ones; when the page was built with
 * different ones, it is built again (KeptSettingsSync). The reads here are the page's own, so this adds no trip.
 */
/** Starts the reads the check needs, so they join the page's own trip (called by the template before the page). */
export function startKeptReads(sb: SupabaseClient, ownerId: string) {
  return [
    oncePerPage(`owner_profile:${ownerId}`, () => sb.from("owner_profile").select("*").eq("owner_id", ownerId).maybeSingle()),
    readWorkInputs(sb, ownerId),
    readPipelineRow(sb, ownerId, "acquisition"),
    readPipelineRow(sb, ownerId, "job"),
    readPipelineRow(sb, ownerId, "consulting"),
  ] as const;
}

export async function KeptSettingsCheck() {
  const { supabase: sb, ownerId } = await requireOwner();
  const [profileP, inputsP, aP, jP, cP] = startKeptReads(sb, ownerId);
  const [{ data: profile }, { data: inputs }, a, j, c, used, raw] = await Promise.all([profileP, inputsP, aP, jP, cP, keptSettings(ownerId), keptCookieRaw()]);
  const p = (profile as Row | null) ?? {};
  const w = workInputs((inputs ?? []) as Row[]);
  const fresh: KeptSettings = {
    o: ownerId,
    tz: String(p.timezone || "America/New_York"),
    th: w.threshold,
    eod: w.eodTime,
    nr: w.noReplyDays,
    dn: p.display_name ? String(p.display_name) : null,
    p: { a: a ? String(a.id) : null, j: j ? String(j.id) : null, c: c ? String(c.id) : null },
    ww: keepWorkWeek(workWeekFromProfile(p)),
    st: w.stalled,
    as: w.autoSend,
    cs: w.countingStart,
  };
  const value = encodeKept(fresh);
  if (process.env.READ_LOG === "1" && used && raw !== value) console.log(`[kept] rebuild: ${raw} -> ${value}`);
  return <KeptSettingsSync value={value} rebuild={!!used && raw !== value} />;
}
