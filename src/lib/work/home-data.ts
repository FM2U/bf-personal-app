import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkCtx, loadWorkNow, type WorkNowData } from "@/lib/work/data";
import type { AiOrder } from "@/lib/work/lanes";
import { loadPipelinesHome, type PipelinesHome } from "@/lib/work/pipelines-data";
import { loadRosaraHome, type RosaraHome } from "@/lib/work/projects-data";
import { loadTargetsTile, type TargetsTile } from "@/lib/accountability/data";
import type { Row } from "@/lib/types";

/**
 * Home (Work on now) in batch B2: everything batch A and B1 read (deals, listings, the glance counts, outreach) plus
 * the Rosara lane and tile, the Job search and Consulting lanes and the Job search tile, and the AI's order of the
 * day when one was made today (ai_order_cache). The rows of every lane merge on Next actions (src/lib/work/lanes.ts).
 */
export type HomeData = WorkNowData & {
  rosara: RosaraHome;
  pipelines: PipelinesHome;
  /** The AI's order made today, or null (By the AI then asks once). */
  aiOrder: AiOrder | null;
  /** The hour of the day in the owner's time zone (for "Ordered by the AI this morning"). */
  hourLocal: number;
  /** The Targets today tile (batch C): two or three target lines, Targets met, End of day with the reasons-left line. */
  targets: TargetsTile;
};

/** The AI's order for a day, from the cache, or null. */
export async function loadAiOrder(sb: SupabaseClient, ownerId: string, today: string): Promise<AiOrder | null> {
  const { data } = await sb.from("ai_order_cache").select("for_date,ordered_ids,reasons,created_at").eq("owner_id", ownerId).eq("for_date", today).maybeSingle();
  const r = data as Row | null;
  if (!r) return null;
  const order = Array.isArray(r.ordered_ids) ? (r.ordered_ids as unknown[]).map(String) : [];
  const reasons = r.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons) ? Object.fromEntries(Object.entries(r.reasons as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])) : {};
  return { order, reasons, forDate: String(r.for_date).slice(0, 10), createdAt: String(r.created_at) };
}

export async function loadHome(sb: SupabaseClient, ownerId: string): Promise<HomeData> {
  const now = await loadWorkNow(sb, ownerId);
  const empty: HomeData = {
    ...now,
    rosara: { focus: "", next: null, open: 0, dueThisWeek: 0, actions: [] },
    pipelines: { jobs: [], consulting: [], tile: { nextConversation: null, nextInterview: null, open: 0, needsAction: 0, waiting: 0 } },
    aiOrder: null,
    hourLocal: 9,
    targets: { available: false, notice: null, today: now.today, lines: [], met: { met: 0, total: 0, names: "" }, eod: { state: "open", badge: "5:30", line: "" } },
  };
  if (!now.available) return empty;
  const ctx = await loadWorkCtx(sb, ownerId);
  const [rosara, pipelines, aiOrder, targets] = await Promise.all([loadRosaraHome(sb, ctx), loadPipelinesHome(sb, ctx), loadAiOrder(sb, ownerId, ctx.today), loadTargetsTile(sb, ctx)]);
  const hourLocal = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", hour12: false }).format(new Date())) || 0;
  return { ...empty, rosara, pipelines, aiOrder, hourLocal: hourLocal % 24, targets };
}
