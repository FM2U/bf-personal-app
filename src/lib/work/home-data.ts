import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkCtx, loadWorkNow, type WorkNowData, prefetchPipelines } from "@/lib/work/data";
import type { AiOrder } from "@/lib/work/lanes";
import { loadPipelinesHome, type PipelinesHome } from "@/lib/work/pipelines-data";
import { loadRosaraHome, type RosaraHome } from "@/lib/work/projects-data";
import { loadHomeTodoLists } from "@/lib/work/personal-todos-data";
import type { PersonalTodo } from "@/lib/work/personal-todos";
import { loadTargetsTile, type TargetsTile } from "@/lib/accountability/data";
import { loadMonthlyDue, type MonthlyDue } from "@/lib/accountability/monthly-data";
import { loadDayCalendar, loadRowBlocks, type DayCalendar } from "@/lib/work/calendar-data";
import { DEFAULT_BLOCK_MINUTES } from "@/lib/work/time-blocks";
import { loadWaitingBoard, type WaitingBoard } from "@/lib/work/waiting-data";
import { DEFAULT_NO_REPLY_DAYS } from "@/lib/work/waiting";
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
  /**
   * The Targets today tile (batch C): two or three target lines, Targets met, End of day with the reasons-left line.
   * Page speed (2026-11-07): on its way when Home is first sent; the card fills in when it arrives.
   */
  targets: Promise<TargetsTile>;
  /** The personal to-dos and dated record tasks due today or earlier: rows on Next actions with the To-do or Task lane pill. */
  todos: PersonalTodo[];
  /** Fix list item 3 (2026-11-06): the same items due after today, for the Due later section. */
  laterTodos: PersonalTodo[];
  /** Push C: Today's calendar (Google Calendar events and the app's blocks), the next block of each row, the default block length. */
  /** On its way when Home is first sent (page speed 2026-11-07): Google Calendar answers after the page is on screen. */
  calendar: Promise<DayCalendar>;
  rowBlocks: Record<string, { date: string; start: string }>;
  blockMinutes: number;
  /** The owner's time zone and the local time now ("HH:MM"), for Block time's first start. */
  nowLocal: string;
  /** Push D: the monthly review due (from the first workday of the month until it is finished), or null. */
  monthlyReview: MonthlyDue | null;
  /** Push E: Waiting on someone: the deals and people waited on, and No reply yet. */
  waiting: Promise<WaitingBoard>;
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
  // Page speed (2026-11-06): the deals and the other Home parts load side by side; only the Waiting card waits for the
  // deals. Before, every part waited for the deals first.
  // Page speed (2026-11-07, approved by Bram): Home is sent once Next actions and the tiles have their data. Today's
  // calendar (it asks Google), Waiting on someone and Targets today are sent as they arrive, each card behind a grey
  // placeholder of its own size until then.
  prefetchPipelines(sb, ownerId);
  const ctx = await loadWorkCtx(sb, ownerId);
  const nowP = loadWorkNow(sb, ownerId);
  const restP = Promise.all([loadRosaraHome(sb, ctx), loadPipelinesHome(sb, ctx), loadAiOrder(sb, ownerId, ctx.today), loadHomeTodoLists(sb, ctx), loadRowBlocks(sb, ownerId, ctx.tz, ctx.today), loadBlockMinutes(sb, ownerId), loadMonthlyDue(sb, ctx)]);
  // A failure in the other parts surfaces where it did before (after the deals), never as an unhandled rejection.
  restP.catch(() => {});
  // The three later cards start now too; the Waiting card waits for the deals only to put them together.
  const calendarP = loadDayCalendar(sb, ownerId, ctx.tz, ctx.today);
  const targetsP = loadTargetsTile(sb, ctx);
  const waitingP = loadWaitingBoard(sb, ctx, nowP.then((n) => n.deals));
  for (const p of [calendarP, targetsP, waitingP]) p.catch(() => {});
  const now = await nowP;
  const noCalendar: DayCalendar = { date: now.today, status: "not_connected", email: null, items: [] };
  const noTargets: TargetsTile = { available: false, notice: null, today: now.today, lines: [], met: { met: 0, total: 0, names: "" }, eod: { state: "open", badge: "5:30", line: "" } };
  const noWaiting: WaitingBoard = { available: false, items: [], noReply: [], noReplyDays: DEFAULT_NO_REPLY_DAYS };
  const empty: HomeData = {
    ...now,
    rosara: { focus: "", next: null, open: 0, dueThisWeek: 0, actions: [] },
    pipelines: { jobs: [], consulting: [], tile: { nextConversation: null, nextInterview: null, open: 0, needsAction: 0, waiting: 0 } },
    aiOrder: null,
    hourLocal: 9,
    targets: Promise.resolve(noTargets),
    todos: [],
    laterTodos: [],
    calendar: Promise.resolve(noCalendar),
    rowBlocks: {},
    blockMinutes: DEFAULT_BLOCK_MINUTES,
    nowLocal: "09:00",
    monthlyReview: null,
    waiting: Promise.resolve(noWaiting),
  };
  if (!now.available) return empty;
  const [rosara, pipelines, aiOrder, todos, rowBlocks, blockMinutes, monthlyReview] = await restP;
  const hourLocal = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", hour12: false }).format(new Date())) || 0;
  const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return { ...empty, rosara, pipelines, aiOrder, hourLocal: hourLocal % 24, targets: targetsP, todos: todos.due, laterTodos: todos.later, calendar: calendarP, rowBlocks, blockMinutes, nowLocal, monthlyReview, waiting: waitingP };
}
