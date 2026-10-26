import Link from "next/link";
import { addDaysISO, weekBounds } from "@/lib/calc/dates";
import type { PeriodResult } from "@/lib/calc/targets";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_FILE } from "@/lib/schema-guard";
import { cn } from "@/lib/utils";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CELL: Record<string, string> = {
  met: "border-emerald-600 bg-emerald-600 text-white",
  missed: "border-red-300 bg-red-50 text-red-700",
  open: "border-teal-600 bg-white text-teal-800 border-2",
  off: "border-slate-100 bg-slate-50 text-slate-300",
  future: "border-dashed border-slate-200 bg-white text-transparent",
};

const STATUS_WORD: Record<string, string> = { met: "met", missed: "missed", open: "in progress", off: "not counted", future: "not yet" };

function Cell({ r, label, today }: { r: PeriodResult | null; label: string; today: string }) {
  const status = !r ? "future" : r.start > today ? "future" : r.status;
  const title = r ? `${label}: ${r.count} of ${r.required}, ${STATUS_WORD[status]}` : label;
  return (
    <div title={title} aria-label={title} className={cn("tabular flex h-9 min-w-0 items-center justify-center rounded border text-xs font-medium", CELL[status])}>
      {status === "future" ? "" : status === "off" ? (r && r.count ? r.count : "") : r?.count}
    </div>
  );
}

/** History by day: one row per week (Monday to Sunday), one aligned cell per day. */
export function TargetDayGrid({ history, today, weeks = 8 }: { history: PeriodResult[]; today: string; weeks?: number }) {
  const byDay = new Map(history.map((h) => [h.start, h]));
  const firstMonday = weekBounds(addDaysISO(today, -7 * (weeks - 1))).start;
  const rows = Array.from({ length: weeks }, (_, w) => addDaysISO(firstMonday, w * 7));
  return (
    <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-1" role="table" aria-label="History by day">
      <div />
      {DAY_HEADERS.map((d) => (
        <div key={d} className="text-center text-[11px] font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {rows.map((monday) => (
        <div key={monday} className="contents" role="row">
          <div className="flex items-center text-[11px] text-muted-foreground tabular">{fmtDate(monday, "MMM d")}</div>
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDaysISO(monday, i);
            return <Cell key={d} r={d > today ? null : byDay.get(d) ?? null} label={fmtDate(d, "EEE MMM d")} today={today} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** History by week for weekly targets: one aligned cell per week. */
export function TargetWeekGrid({ history, today, weeks = 12 }: { history: PeriodResult[]; today: string; weeks?: number }) {
  const byWeek = new Map(history.map((h) => [h.start, h]));
  const firstMonday = weekBounds(addDaysISO(today, -7 * (weeks - 1))).start;
  const cols = Array.from({ length: weeks }, (_, w) => addDaysISO(firstMonday, w * 7));
  return (
    <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-12">
      {cols.map((monday) => (
        <div key={monday} className="flex min-w-0 flex-col gap-1">
          <span className="clamp-1 text-center text-[11px] text-muted-foreground tabular">{fmtDate(monday, "MMM d")}</span>
          <Cell r={byWeek.get(monday) ?? null} label={`Week of ${fmtDate(monday)}`} today={today} />
        </div>
      ))}
    </div>
  );
}

export function TargetLegend() {
  const items: [string, string][] = [
    ["met", "Met"],
    ["missed", "Missed"],
    ["open", "Today (in progress)"],
    ["off", "Not counted"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([k, l]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-3 rounded-sm border", CELL[k])} />
          {l}
        </span>
      ))}
      <span>The number in each cell is the count.</span>
    </div>
  );
}

/** Small notice shown where a feature needs database update 0008. */
export function DbUpdateNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50 text-amber-900", compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm")}>
      <span className="font-semibold">Database update needed:</span> paste <code className="rounded bg-amber-100 px-1 text-[0.95em]">{DB_UPDATE_FILE}</code> into the Supabase SQL Editor and run it.{" "}
      {compact ? null : (
        <Link href="/accountability/targets" className="underline">
          Daily Targets
        </Link>
      )}
      {compact ? null : " and the Outreach Queue appear after the update."}
    </div>
  );
}
