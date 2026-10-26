import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { StatusBadge } from "@/components/app/field-value";
import { resolveMiss } from "@/app/actions/records";
import { recordHref } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Commitments" };

export default async function CommitmentsPage({ searchParams }: { searchParams: Promise<{ miss?: string }> }) {
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
  const open = list.filter((c) => c.status === "open");
  const repeated = list.filter((c) => c.miss_count >= 2);
  return (
    <div>
      <PageHeader title="Commitments" description="Any task, milestone, or goal marked as a commitment, with a due date. A miss is recorded, needs a one-line reason, and then a new date or a decision record." />
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
                  <form key={m.id} action={resolveMiss} className={`grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] ${sp.miss === m.id ? "border-amber-400 bg-amber-50/50" : "border-border"}`}>
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
                      <Input name="reason" placeholder="One-line reason (required)" required maxLength={200} aria-label="Reason" />
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-1">
                          <input type="radio" name="resolution" value="new_date" defaultChecked className="accent-teal-700" /> New date
                        </label>
                        <Input name="new_due_date" type="date" className="w-40" aria-label="New due date" defaultValue={ctx.today} />
                        <label className="flex items-center gap-1">
                          <input type="radio" name="resolution" value="decision" className="accent-teal-700" /> Open a decision
                        </label>
                      </div>
                      <SubmitButton size="sm" className="self-start">
                        Save
                      </SubmitButton>
                    </div>
                  </form>
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
            <CardDescription>Shown in the weekly review and in partner reports.</CardDescription>
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
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Open commitments</CardTitle>
            <CardDescription>To add one, open a task, milestone, or goal and press Mark as commitment.</CardDescription>
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
                      <TD className={c.due_date < ctx.today ? "font-medium text-red-700" : ""}>{fmtDate(c.due_date)}</TD>
                      <TD>{fmtDate(c.original_due_date)}</TD>
                      <TD>{c.miss_count}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="No open commitments." body="Open a task, milestone, or goal and press Mark as commitment. Recurring templates marked as commitments create them automatically." />
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
                        {m.resolution === "new_date" ? (
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
