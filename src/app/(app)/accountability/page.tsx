import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge, StatusDot, dueClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { OpenReviewButton } from "@/components/app/open-review-button";
import { Tile, TileRow } from "@/components/app/target-card";
import { recordHref } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import { dueStatus, type Status } from "@/lib/status";
import { resolveHref, resolveParam } from "@/lib/window-route";
import { addDaysISO } from "@/lib/calc/dates";
import { resolutionLabel } from "@/lib/calc/resolve-miss";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListFilter } from "@/components/app/filter-panel";
import { applyFilters, dateMatches, DUE_BUCKETS, filterHref, isDefaultFilters, plainParams, readFilters, type FilterSpec, type FilterState } from "@/lib/list-filters";

/**
 * The commitments list filter, in the address. Status shows missed commitments that still need a reason and open
 * ones by default ("missed" is the status until a reason and a new date or decision are saved). When met, Type,
 * Due date, and Times missed have no default.
 */
const COMMITMENT_FILTERS: FilterSpec[] = [
  {
    column: {
      key: "status",
      title: "Status",
      defaults: ["missed", "open"],
      options: [
        { value: "missed", label: "Missed, needs a reason" },
        { value: "open", label: "Open" },
        { value: "met", label: "Met" },
        { value: "closed_by_decision", label: "Closed by a decision" },
        { value: "done_late", label: "Done late" },
        { value: "released", label: "No longer a commitment" },
      ],
    },
    test: (c, p) => p.includes(String(c.status)),
  },
  {
    column: { key: "met", title: "When met", options: [{ value: "7", label: "Met in the last 7 days" }, { value: "30", label: "Met in the last 30 days" }, { value: "90", label: "Met in the last 90 days" }, { value: "older", label: "Met more than 90 days ago" }] },
    test: (c, p, today) => c.status === "met" && !!c.met_on && dateMatches(c.met_on, p, "past", today),
  },
  { column: { key: "type", title: "Type", options: [{ value: "tasks", label: "Task" }, { value: "milestones", label: "Milestone" }, { value: "goals", label: "Goal" }] }, test: (c, p) => p.includes(String(c.record_type)) },
  { column: { key: "due", title: "Due date", options: DUE_BUCKETS.filter((b) => b.value !== "none") }, test: (c, p, today) => dateMatches(c.due_date, p, "due", today) },
  { column: { key: "missed", title: "Times missed", options: [{ value: "0", label: "Never" }, { value: "1", label: "Once" }, { value: "2", label: "2 or more" }] }, test: (c, p) => p.includes(String(Math.min(2, Number(c.miss_count ?? 0)))) },
];

const TYPE_LABEL: Record<string, string> = { tasks: "Task", milestones: "Milestone", goals: "Goal" };

/** The row's status badge: what the owner needs to know at a glance. */
function rowStatus(c: Row, pendingMiss: boolean, today: string): { status: Status; label: string } {
  if (c.status === "missed") return { status: "missed", label: pendingMiss ? "Reason needed" : "Missed" };
  if (c.status === "met") return { status: "met", label: "Met" };
  if (c.status === "closed_by_decision") return { status: "neutral", label: "Closed by a decision" };
  if (c.status === "done_late") return { status: "soon", label: "Done late" };
  if (c.status === "released") return { status: "neutral", label: "No longer a commitment" };
  const s = dueStatus(c.due_date, today);
  // Due today and due this week are shown as a small label next to the badge.
  return { status: s === "missed" ? "missed" : "neutral", label: s === "missed" ? "Overdue" : "Open" };
}

/** Missed (needs a reason) first, then open by soonest due date, then the rest (most recent first). */
function sortRows(rows: Row[]): Row[] {
  const rank = (c: Row) => (c.status === "missed" ? 0 : c.status === "open" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? String(a.due_date).localeCompare(String(b.due_date)) : String(b.due_date).localeCompare(String(a.due_date))));
}

// Fixed column widths so every row lines up (from md). Phone: each row stacks.
const ROW_COLS = "md:grid-cols-[minmax(0,1fr)_6rem_7rem_10.5rem_5.5rem_6.5rem]";

export const metadata = { title: "Commitments" };

export default async function CommitmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // Older links (Home alerts made before the resolve section) open the task window with "Resolve this miss" over this page.
  if (sp.miss && !sp.w && /^[0-9a-f-]{36}$/i.test(sp.miss)) redirect(`/accountability?w=resolve/${sp.miss}`);
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const today = ctx.today;
  const [{ data: commitments }, { data: misses }] = await Promise.all([
    supabase.from("commitments").select("*").order("due_date"),
    supabase.from("missed_commitments").select("*").order("missed_on", { ascending: false }),
  ]);
  const list = (commitments ?? []) as Row[];
  const byId = Object.fromEntries(list.map((c) => [c.id, c]));
  // The newest miss still waiting for a reason, per commitment (the Resolve button opens it).
  const pendingByCommitment: Record<string, string> = {};
  for (const m of (misses ?? []) as Row[]) if (m.resolution === "pending" && !pendingByCommitment[m.commitment_id]) pendingByCommitment[m.commitment_id] = m.id;
  const resolved = ((misses ?? []) as Row[]).filter((m) => m.resolution !== "pending");

  const filterCols = COMMITMENT_FILTERS.map((f) => f.column);
  const filterState = readFilters(sp, filterCols);
  const filtering = !isDefaultFilters(filterState, filterCols);
  const keep = plainParams(sp);
  delete keep.miss;
  const rows = sortRows(applyFilters(list, COMMITMENT_FILTERS, filterState, today));
  const repeated = list.filter((c) => c.miss_count >= 2 && c.status !== "released");

  // Count bar: each tile applies its filter in the address (the same address the Filter panel writes).
  const empty: FilterState = Object.fromEntries(filterCols.map((c) => [c.key, []]));
  const weekEnd = addDaysISO(today, 7);
  const dueThisWeek = list.filter((c) => c.status === "open" && c.due_date >= today && c.due_date <= weekEnd).length;
  const tiles = [
    { key: "resolve", label: "To resolve", note: "Missed, reason needed", state: { ...empty, status: ["missed"] }, count: list.filter((c) => c.status === "missed").length, bad: true },
    { key: "open", label: "Open", note: `${dueThisWeek} due this week`, state: { ...empty, status: ["open"] }, count: list.filter((c) => c.status === "open").length },
    { key: "met", label: "Met", note: "Last 30 days", state: { ...empty, status: ["met"], met: ["30"] }, count: list.filter((c) => c.status === "met" && !!c.met_on && dateMatches(c.met_on, ["30"], "past", today)).length },
  ];
  const sameState = (a: FilterState, b: FilterState) => filterCols.every((c) => {
    const x = a[c.key] ?? [];
    const y = b[c.key] ?? [];
    return x.length === y.length && x.every((v) => y.includes(v));
  });

  return (
    <div>
      <PageHeader
        title="Commitments"
        description="Commitments are pipeline next actions, milestones, daily targets, and the scheduled reviews (plus any task marked as a commitment). A miss needs a one-line reason, then a new date or a decision. Other tasks are regular tasks: if not done, they move to the next day automatically."
        actions={
          <>
            <OpenReviewButton kind="daily" size="sm">
              Daily close
            </OpenReviewButton>
            <OpenReviewButton kind="weekly" size="sm" variant="outline">
              Weekly review
            </OpenReviewButton>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <nav aria-label="Commitment counts" className="max-w-2xl">
          <TileRow cols={3} phoneOneRow testId="commitment-counts">
            {tiles.map((t) => {
              const active = sameState(filterState, t.state);
              return (
                <Link
                  key={t.key}
                  href={filterHref("/accountability", t.state, filterCols, keep)}
                  aria-current={active ? "true" : undefined}
                  className={cn("flex flex-col border-slate-200 transition-colors first:rounded-l-lg last:rounded-r-lg hover:bg-slate-50 focus-visible:relative focus-visible:outline-2 focus-visible:outline-ring [&>*]:flex-1", active && "bg-primary-soft shadow-[inset_0_-3px_0_var(--primary)] hover:bg-primary-soft")}
                  data-testid={`count-${t.key}`}
                >
                  <Tile label={t.label} value={t.count} note={t.note} valueClass={t.bad && t.count ? "text-status-missed" : active ? "text-primary-strong" : undefined} />
                </Link>
              );
            })}
          </TileRow>
        </nav>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Commitments</CardTitle>
            <div className="mt-1">
              <ListFilter path="/accountability" layout={[[filterCols[0], filterCols[1]], [filterCols[2]], [filterCols[3]], [filterCols[4]]]} state={filterState} keep={keep} testId="commitments-filter" />
            </div>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <div role="table" aria-label="Commitments" className="flex flex-col" data-testid="commitments-list">
                <div role="row" className={cn("hidden gap-4 border-b border-slate-200 px-3 pb-2 text-xs font-medium text-slate-600 md:grid", ROW_COLS)}>
                  <span role="columnheader">Commitment</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Due</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Times missed</span>
                  <span role="columnheader" className="sr-only">
                    Action
                  </span>
                </div>
                {rows.map((c) => {
                  const missId = pendingByCommitment[c.id];
                  const needsReason = c.status === "missed";
                  const st = rowStatus(c, !!missId, today);
                  // Open rows: a small label for what is due soon (amber today, gray within the next 7 days).
                  const when = c.status !== "open" ? null : c.due_date === today ? "Due today" : c.due_date > today && c.due_date <= weekEnd ? "This week" : null;
                  const href = recordHref(c.record_type, c.record_id);
                  return (
                    <div
                      role="row"
                      key={c.id}
                      className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0", ROW_COLS, needsReason && "bg-status-missed-bg/60")}
                      data-testid="commitment-row"
                      data-status={c.status}
                    >
                      <div role="cell" className="col-span-2 flex min-w-0 items-start gap-2 md:col-span-1">
                        <StatusDot status={needsReason ? "missed" : st.status === "neutral" ? "neutral" : st.status} className="mt-1.5" />
                        <Link href={href} className="clamp-2 min-w-0 text-sm font-medium text-slate-900 hover:underline" title={c.title}>
                          {c.title}
                        </Link>
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700 md:contents">
                        <span role="cell" className="clamp-1">
                          {TYPE_LABEL[c.record_type] ?? "Task"}
                        </span>
                        <span role="cell" className={cn("tabular whitespace-nowrap", c.status === "open" && dueClass(c.due_date, today))}>
                          <span className="text-slate-500 md:hidden">Due </span>
                          {fmtDate(c.due_date)}
                        </span>
                        <span role="cell" className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-1">
                            <StatusBadge status={st.status} className="max-w-full truncate">
                              {st.label}
                            </StatusBadge>
                            {when ? (
                              <span className={cn("whitespace-nowrap text-xs font-medium", when === "Due today" ? "text-status-soon" : "text-slate-500")} data-testid="commitment-when">
                                {when}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span role="cell" className={cn("tabular whitespace-nowrap", Number(c.miss_count) > 0 ? "font-medium text-status-missed" : "max-md:hidden")}>
                          <span className="md:hidden">Missed </span>
                          {c.miss_count ?? 0}
                          <span className="md:hidden">{Number(c.miss_count) === 1 ? " time" : " times"}</span>
                        </span>
                      </div>
                      <div role="cell" className="col-span-2 md:col-span-1 md:justify-self-end">
                        {missId ? (
                          <Button asChild size="sm" className="w-full md:w-[5.5rem]">
                            <Link href={resolveHref(c.id, missId)} data-window={resolveParam(c.id, missId)} data-testid="commitment-resolve">
                              Resolve
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild size="sm" variant="outline" className="w-full md:w-[5.5rem]">
                            <Link href={href} data-testid="commitment-open">
                              Open
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                compact
                title={filtering ? "No commitments match these filters." : "No missed or open commitments."}
                body={filtering ? "Remove a filter label above, or press Reset." : "Pipeline next actions and the review tasks create them automatically. To add one, open a task or milestone and press Mark as commitment."}
              />
            )}
          </CardContent>
          <CardNote>Missed commitments that need a reason come first, then open ones by due date. Met and closed ones are in Filter, Status. To add one, open a task, milestone, or goal and press Mark as commitment.</CardNote>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Resolved misses</CardTitle>
            </CardHeader>
            <CardContent>
              {resolved.length ? (
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Missed</TH>
                      <TH>Commitment</TH>
                      <TH>Reason</TH>
                      <TH>Resolution</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {resolved.slice(0, 50).map((m) => (
                      <TR key={m.id}>
                        <TD className="whitespace-nowrap">{fmtDate(m.missed_on)}</TD>
                        <TD>{byId[m.commitment_id]?.title}</TD>
                        <TD className="max-w-sm">{m.reason}</TD>
                        <TD>
                          {m.resolution === "decision" && m.decision_id ? (
                            <Link href={`/records/decisions/${m.decision_id}`} className="underline">
                              Decision opened
                            </Link>
                          ) : (
                            <span className="whitespace-nowrap" data-testid="miss-resolution">
                              {resolutionLabel(m as { resolution: string; done_on?: string | null; new_due_date?: string | null })}
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No resolved misses yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Repeated misses</CardTitle>
            </CardHeader>
            <CardContent>
              {repeated.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {repeated.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <Link href={recordHref(c.record_type, c.record_id)} className="clamp-1 hover:underline">
                        {c.title}
                      </Link>
                      <Badge variant="danger">{c.miss_count} misses</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No commitment has been missed more than once.</p>
              )}
            </CardContent>
            <CardNote>Shown in the weekly review and in partner reports.</CardNote>
          </Card>
        </div>
      </div>
    </div>
  );
}
