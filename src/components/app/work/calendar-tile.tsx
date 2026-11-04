import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import type { DayCalendar } from "@/lib/work/calendar-data";
import { shortTime, type DayItem } from "@/lib/work/time-blocks";
import { ShowAll } from "@/components/app/work/show-all";
import { Pill, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Today's calendar on Home (push C, approved 2026-11-02): today's Google Calendar events and the app's blocks (a
 * Block pill and "Blocked from Next actions"), in time order, in the right column. Each row keeps the same two
 * columns (the start over "to" the end, then the title over where it came from), so the times line up when a title
 * wraps. The long-list rule: the first 8, then Show all. Without Google or without the calendar permission the tile
 * shows a plain note (and the app's own blocks), never an error.
 */
export function CalendarTile({ calendar }: { calendar: DayCalendar }) {
  const items = calendar.items;
  const note = calendar.status === "ok" ? null : calendar.status === "unavailable" ? "Google Calendar did not answer. Your blocks still show here." : "Reconnect Google to see your calendar.";
  const row = (it: DayItem) => (
    <div key={it.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 border-t border-slate-100 px-[22px] py-[9px] first:border-t-0" data-testid="calendar-item" data-kind={it.kind}>
      <div className="tabular leading-tight">
        <div className="text-[13px] font-semibold text-slate-900">{shortTime(it.start)}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">to {shortTime(it.end)}</div>
      </div>
      <div className="min-w-0 leading-tight">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {it.kind === "block" ? (
            <Pill tone="blue" className="px-[7px] py-0 text-[11px]" testId="calendar-block-pill">
              Block
            </Pill>
          ) : null}
          <span className="min-w-0 text-[13.5px] font-medium text-slate-900">{it.title}</span>
        </div>
        <div className={cn("mt-0.5 text-[12px]", it.kind === "block" ? "text-primary-strong" : "text-muted-foreground")}>{it.from ?? (it.kind === "block" ? "Blocked from Next actions" : "Google Calendar")}</div>
      </div>
    </div>
  );
  return (
    <WorkCard title="Today's calendar" count={items.length || null} sub={calendar.status === "ok" ? "From Google Calendar · your blocks are marked" : "Your blocks from the app"} testId="home-calendar" pinned>
      {note ? (
        <p className="px-[22px] pt-3 pb-1 text-[13px] text-muted-foreground" data-testid="calendar-note">
          {note}{" "}
          <Link href="/settings" className="font-medium text-primary-strong hover:underline">
            Settings, Connections
          </Link>
        </p>
      ) : null}
      <div className="flex flex-col pt-1" data-testid="calendar-items">
        <ShowAll items={items} render={(it) => row(it)} title="Today's calendar" sub={`All ${items.length}, in time order`} text={(it) => it.title} testId="calendar-all" />
        {!items.length && !note ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground" data-testid="calendar-empty">Nothing on the calendar today.</p> : null}
      </div>
      <div className="flex items-center gap-1.5 border-t border-slate-100 px-[22px] pt-2.5 pb-4 text-[12.5px] text-muted-foreground">
        Block time on any next action with <CalendarPlus className="h-3.5 w-3.5 text-slate-500" aria-label="the block icon" />
      </div>
    </WorkCard>
  );
}
