import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, dueClass } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { StatusBadge } from "@/components/app/field-value";
import { resolveMiss } from "@/app/actions/records";
import { OpenReviewButton } from "@/components/app/open-review-button";
import { recordHref } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ListFilter } from "@/components/app/filter-panel";
import { applyFilters, dateMatches, DUE_BUCKETS, isDefaultFilters, plainParams, readFilters, type FilterSpec } from "@/lib/list-filters";

/** The commitments list filter: Status (open by default), Type, Due date, Times missed. In the address. */
const COMMITMENT_FILTERS: FilterSpec[] = [
  {
    column: { key: "status", title: "Status", defaults: ["open"], options: [{ value: "open", label: "Open" }, { value: "met", label: "Met" }, { value: "missed", label: "Missed" }, { value: "closed_by_decision", label: "Closed by a decision" }, { value: "released", label: "No longer a commitment" }] },
    test: (c, p) => p.includes(String(c.status)),
  },
  { column: { key: "type", title: "Type", options: [{ value: "tasks", label: "Task" }, { value: "milestones", label: "Milestone" }, { value: "goals", label: "Goal" }] }, test: (c, p) => p.includes(String(c.record_type)) },
  { column: { key: "due", title: "Due date", options: DUE_BUCKETS.filter((b) => b.value !== "none") }, test: (c, p, today) => dateMatches(c.due_date, p, "due", today) },
  { column: { key: "missed", title: "Times missed", options: [{ value: "0", label: "Never" }, { value: "1", label: "Once" }, { value: "2", label: "2 or more" }] }, test: (c, p) => p.includes(String(Math.min(2, Number(c.miss_count ?? 0)))) },
];

export const metadata = { title: "Commitments" };

export default async function CommitmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: commitments }, { data: misses }] = await Promise.all([
    supabase.from("commitments").select("*").order("due_date"),
    supabase.from("missed_commitments").select("*").order("missed_on", { ascending: false }),
  ]);
  const list = (commitments ?? []) as Row[];
  const byId = Object.fromEntries(list.map((c) => [c.id, c]));
  const pending = ((misses ?? []) as Row[]).filter((m) => m.resolution === "pending");
  const resolved = ((misses ?? []) as Row[]).filter((m) => m.resolution !== "pending");
  const filterCols = COMMITMENT_FILTERS.map((f) => f.column);
  const filterState = readFilters(sp, filterCols);
  const filtering = !isDefaultFilters(filterState, filterCols);
  const open = applyFilters(list, COMMITMENT_FILTERS, filterState, ctx.today);
  const repeated = list.filter((c) => c.miss_count >= 2 && c.status !== "released");
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
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Missed commitments to resolve {pending.length ? <Badge variant="danger">{pending.length}</Badge> : null}</CardTitle>
            <CardDescription>Give a one-line reason, then set a new date or open a decision record.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pending.length ? (
              pending.map((m) => {
                const c = byId[m.commitment_id];
                return (
                  <GuardedForm key={m.id} action={resolveMiss} className={`grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] ${sp.miss === m.id ? "border-status-soon-border bg-status-soon-bg" : "border-border"}`}>
                    <input type="hidden" name="miss_id" value={m.id} />
                    <div className="min-w-0">
                      <Link href={c ? recordHref(c.record_type, c.record_id) : "#"} className="clamp-2 text-sm font-medium hover:underline">
                        {c?.title ?? "Commitment"}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Missed {fmtDate(m.missed_on)}. Times missed: {c?.miss_count ?? 1}.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Input name="reason" defaultValue={m.reason ?? ""} placeholder="One-line reason (required)" required maxLength={200} aria-label="Reason" />
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-1">
                          <input type="radio" name="resolution" value="new_date" defaultChecked className="accent-primary" /> New date
                        </label>
                        <Input name="new_due_date" type="date" className="w-40" aria-label="New due date" defaultValue={ctx.today} />
                        <label className="flex items-center gap-1">
                          <input type="radio" name="resolution" value="decision" className="accent-primary" /> Open a decision
                        </label>
                      </div>
                      <SubmitButton size="sm" className="self-start">
                        Save
                      </SubmitButton>
                    </div>
                  </GuardedForm>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No missed commitments waiting for a reason.</p>
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
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Commitments</CardTitle>
            <CardDescription>To add one, open a task, milestone, or goal and press Mark as commitment.</CardDescription>
            <div className="mt-2">
              <ListFilter path="/accountability" layout={[[filterCols[0]], [filterCols[1]], [filterCols[2]], [filterCols[3]]]} state={filterState} keep={plainParams(sp)} testId="commitments-filter" />
            </div>
          </CardHeader>
          <CardContent>
            {open.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Commitment</TH>
                    <TH>Type</TH>
                    <TH>Due</TH>
                    <TH>Original due date</TH>
                    <TH>Times missed</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {open.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <Link href={recordHref(c.record_type, c.record_id)} className="font-medium hover:underline">
                          {c.title}
                        </Link>
                      </TD>
                      <TD>{c.record_type === "tasks" ? "Task" : c.record_type === "milestones" ? "Milestone" : "Goal"}</TD>
                      <TD className={dueClass(c.due_date, ctx.today)}>{fmtDate(c.due_date)}</TD>
                      <TD>{fmtDate(c.original_due_date)}</TD>
                      <TD>{c.miss_count}</TD>
                      <TD>
                        <StatusBadge status={c.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState
                title={filtering ? "No commitments match these filters." : "No open commitments."}
                body={filtering ? "Remove a filter label above, or press Reset." : "Pipeline next actions and the review tasks create them automatically. To add one, open a task or milestone and press Mark as commitment."}
              />
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-3">
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
                        {m.resolution === "released" ? (
                          "No longer a commitment"
                        ) : m.resolution === "new_date" ? (
                          `New date ${fmtDate(m.new_due_date)}`
                        ) : m.decision_id ? (
                          <Link href={`/records/decisions/${m.decision_id}`} className="underline">
                            Decision opened
                          </Link>
                        ) : (
                          <StatusBadge status={m.resolution} />
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
      </div>
    </div>
  );
}
