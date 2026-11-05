import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkCtx, loadWorkNow, type WorkNowData } from "@/lib/work/data";
import type { AiOrder } from "@/lib/work/lanes";
import { loadPipelinesHome, type PipelinesHome } from "@/lib/work/pipelines-data";
import { loadRosaraHome, type RosaraHome } from "@/lib/work/projects-data";
import { loadHomeTodos } from "@/lib/work/personal-todos-data";
import type { PersonalTodo } from "@/lib/work/personal-todos";
import { loadTargetsTile, type TargetsTile } from "@/lib/accountability/data";
import { loadMonthlyDue, type MonthlyDue } from "@/lib/accountability/monthly-data";
import { loadDayCalendar, loadRowBlocks, type DayCalendar } from "@/lib/work/calendar-data";
import { DEFAULT_BLOCK_MINUTES } from "@/lib/work/time-blocks";
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
  /** The personal to-dos and dated record tasks due today or earlier: rows on Next actions with the To-do or Task lane pill. */
  todos: PersonalTodo[];
  /** Push C: Today's calendar (Google Calendar events and the app's blocks), the next block of each row, the default block length. */
  calendar: DayCalendar;
  rowBlocks: Record<string, { date: string; start: string }>;
  blockMinutes: number;
  /** The owner's time zone and the local time now ("HH:MM"), for Block time's first start. */
  nowLocal: string;
  /** Push D: the monthly review due (from the first workday of the month until it is finished), or null. */
  monthlyReview: MonthlyDue | null;
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

/** The default block length (push C; its Settings field comes in push D): 60 minutes unless changed. */
async function loadBlockMinutes(sb: SupabaseClient, ownerId: string): Promise<number> {
  const { data, error } = await sb.from("owner_profile").select("default_block_minutes").eq("owner_id", ownerId).maybeSingle();
  const n = Number((data as Row | null)?.default_block_minutes);
  return !error && Number.isFinite(n) && n >= 5 ? n : DEFAULT_BLOCK_MINUTES;
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
    todos: [],
    calendar: { date: now.today, status: "not_connected", email: null, items: [] },
    rowBlocks: {},
    blockMinutes: DEFAULT_BLOCK_MINUTES,
    nowLocal: "09:00",
    monthlyReview: null,
  };
  if (!now.available) return empty;
  const ctx = await loadWorkCtx(sb, ownerId);
  const [rosara, pipelines, aiOrder, targets, todos, calendar, rowBlocks, blockMinutes, monthlyReview] = await Promise.all([loadRosaraHome(sb, ctx), loadPipelinesHome(sb, ctx), loadAiOrder(sb, ownerId, ctx.today), loadTargetsTile(sb, ctx), loadHomeTodos(sb, ctx), loadDayCalendar(sb, ownerId, ctx.tz, ctx.today), loadRowBlocks(sb, ownerId, ctx.tz, ctx.today), loadBlockMinutes(sb, ownerId), loadMonthlyDue(sb, ctx)]);
  const hourLocal = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", hour12: false }).format(new Date())) || 0;
  const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return { ...empty, rosara, pipelines, aiOrder, hourLocal: hourLocal % 24, targets, todos, calendar, rowBlocks, blockMinutes, nowLocal, monthlyReview };
}
