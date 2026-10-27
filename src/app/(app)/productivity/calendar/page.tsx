import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { getGoogleConnection } from "@/lib/google";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTodaysBlocks, localMinutes } from "@/lib/engine/time-blocks";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader } from "@/components/app/page-header";
import { ModuleTitle } from "@/components/app/module-icon";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { SuggestBlocksButton, TimeBlockSuggestions, type BlockRow } from "@/components/app/time-block-suggestions";
import { blockState, clock } from "@/lib/time-blocks";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Calendar time blocks" };

const KIND: Record<string, string> = { time_block: "Time block", review: "Review", follow_up: "Follow-up", meeting: "Meeting" };

export default async function CalendarPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [google, today, { data: recent }] = await Promise.all([
    getGoogleConnection(supabase, ownerId),
    loadTodaysBlocks(supabase, ownerId, ctx.today),
    supabase.from("calendar_events").select("*").order("starts_at", { ascending: false }).limit(120),
  ]);
  const connected = google?.status === "connected";
  const toRow = (r: Row): BlockRow => ({ id: r.id, title: r.title, taskId: r.task_id ?? null, startMin: localMinutes(r.starts_at, ctx.tz), endMin: localMinutes(r.ends_at, ctx.tz) });
  // A block added by hand waits for approval like a suggestion.
  const suggested = today.filter((r) => r.state === "suggested" || r.state === "manual").map(toRow);
  const added = today.filter((r) => r.state === "approved").map(toRow);
  // Every calendar event the app made, without suggestions that are waiting or were deleted.
  const history = ((recent ?? []) as Row[]).filter((r) => r.kind !== "time_block" || ["approved", "manual"].includes(blockState(r))).slice(0, 60);
  return (
    <div>
      <PageHeader
        title="Calendar time blocks"
        description="Each morning the app suggests time blocks for your priority tasks. Approve the ones you want; only approved blocks go to Google Calendar."
        actions={<SuggestBlocksButton />}
      />
      {!connected ? (
        <div className="mb-4">
          <Notice tone="warn">
            Google is not connected, so blocks cannot be approved yet. <Link href="/settings" className="font-medium underline">Connect Google</Link>.
          </Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" id="suggested">
          <CardHeader>
            <CardTitle>
              <ModuleTitle module="productivity">Suggested for today</ModuleTitle>
            </CardTitle>
            <CardDescription>Block length and number per day are set in Inputs and Assumptions (Productivity).</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeBlockSuggestions rows={suggested} connected={connected} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In Google Calendar today</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {added.length ? (
              <ul className="flex flex-col divide-y divide-slate-100" data-testid="time-blocks-added">
                {added.map((b) => (
                  <li key={b.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-2 text-sm">
                    <span className="tabular text-muted-foreground">{clock(b.startMin)}</span>
                    <span className="clamp-2">{b.title.replace(/^Focus: /, "")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No approved blocks today.</p>
            )}
            <Link href="/records/calendar_events/new?kind=time_block" className="self-start text-sm font-medium text-primary-strong hover:underline" data-testid="add-block-manually">
              Add a block manually
            </Link>
          </CardContent>
          <CardNote>Blocks you approved today. A block added by hand waits for approval in Suggested for today.</CardNote>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Calendar events from the app</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Starts</TH>
                  <TH>Ends</TH>
                  <TH>Title</TH>
                  <TH>Kind</TH>
                  <TH>Google Calendar</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((r) => (
                  <TR key={r.id}>
                    <TD className="tabular whitespace-nowrap">{dateTime(r.starts_at)}</TD>
                    <TD className="tabular whitespace-nowrap text-muted-foreground">{dateTime(r.ends_at)}</TD>
                    <TD>
                      <Link href={`/records/calendar_events/${r.id}`} className="clamp-1 font-medium text-slate-900 hover:text-primary-strong hover:underline">
                        {r.title}
                      </Link>
                    </TD>
                    <TD>{KIND[r.kind] ?? r.kind}</TD>
                    <TD>{r.google_event_id ? <StatusBadge status="met">Added</StatusBadge> : <StatusBadge status="neutral">Only in the app</StatusBadge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState compact title="No calendar events yet." body="Approved time blocks, reviews, and follow-ups appear here." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
