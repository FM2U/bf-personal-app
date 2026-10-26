import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SubmitButton } from "@/components/app/submit-button";
import { DetailGrid, EmptyState, Notice, Stat } from "@/components/app/page-header";
import { RecordForm } from "@/components/app/record-form";
import { ProposalCard } from "@/components/app/proposal-card";
import { markCommitment, setTaskStatus } from "@/app/actions/records";
import {
  checkConditionsNow,
  chooseOption,
  completeMilestone,
  createPartnerLink,
  createReportNow,
  generateRepayments,
  moveStage,
  revokePartnerLink,
  setRecurringReview,
  toggleDiligence,
} from "@/app/actions/domain";
import { requestReductionSuggestions } from "@/app/actions/ai";
import { computeMetrics } from "@/lib/metrics";
import { daysBetween } from "@/lib/calc/dates";
import { date as fmtDate, dateTime, money, num } from "@/lib/format";
import { decrypt } from "@/lib/crypto";
import { env, isAIConfigured } from "@/lib/env";
import { recordHref } from "@/lib/resources";
import type { RefOption } from "@/lib/data";
import { GROUP_LABELS, OUTCOME_LABELS, outreachStatus, type RelationshipGroup } from "@/lib/calc/outreach";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { describeTarget } from "@/lib/calc/targets";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { loadTargets, summarizeTargets } from "@/lib/targets";
import { OUTCOME_OPTIONS } from "@/lib/resources";
import { setOutreachOutcome } from "@/app/actions/targets";
import { LogOutreachButton } from "@/components/app/outreach-actions";
import { DbUpdateNotice, TargetDayGrid, TargetLegend, TargetWeekGrid } from "@/components/app/target-grid";
import type { Row } from "@/lib/types";

type P = { sb: SupabaseClient; ownerId: string; table: string; row: Row; today: string; labels: Record<string, Record<string, string>>; refOptions: Record<string, RefOption[]> };

/** Record-specific panels shown in the main column of the record page. */
export async function ExtraPanels(p: P) {
  switch (p.table) {
    case "pipeline_items":
      return <PipelineItemPanels {...p} />;
    case "funding_sources":
      return <FundingPanel {...p} />;
    case "decisions":
      return <DecisionPanel {...p} />;
    case "transactions":
    case "recurring_series":
      return <ReductionPanel {...p} />;
    case "inputs":
      return <InputHistoryPanel {...p} />;
    case "partners":
      return <PartnerLinksPanel {...p} />;
    case "goals":
      return <GoalProgress {...p} />;
    case "contacts":
      return <ContactOutreachPanel {...p} />;
    case "targets":
      return <TargetHistoryPanel {...p} />;
    default:
      return null;
  }
}

/** Record-specific panels shown in the side column. */
export async function ExtraSidePanels(p: P) {
  const panels: React.ReactNode[] = [];
  if (p.table === "tasks") {
    panels.push(
      <Card key="task">
        <CardContent className="flex flex-col gap-2 pt-5">
          <form
            action={async () => {
              "use server";
              await setTaskStatus(p.row.id, p.row.status !== "done");
            }}
          >
            <SubmitButton size="sm" variant={p.row.status === "done" ? "outline" : "default"} className="w-full">
              {p.row.status === "done" ? "Mark as not done" : "Mark as done"}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>,
    );
  }
  if (p.table === "milestones" && !["met"].includes(p.row.status)) {
    panels.push(
      <Card key="met">
        <CardHeader>
          <CardTitle>Mark milestone met</CardTitle>
          <CardDescription>Proof of completion is required: a number, a link, or an uploaded document.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={completeMilestone} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={p.row.id} />
            <Input name="proof" placeholder={p.row.proof_type === "link" ? "Link to proof" : p.row.proof_type === "number" ? "Number achieved" : "Optional note (upload the document below)"} defaultValue={p.row.proof_value ?? ""} />
            <SubmitButton size="sm">Mark met</SubmitButton>
          </form>
        </CardContent>
      </Card>,
    );
  }
  if (["tasks", "milestones", "goals"].includes(p.table)) {
    const { data: c } = await p.sb.from("commitments").select("*").eq("record_type", p.table).eq("record_id", p.row.id).maybeSingle();
    panels.push(
      <Card key="commit">
        <CardHeader>
          <CardTitle>Commitment</CardTitle>
          <CardDescription>A commitment is checked against its due date. A miss requires a reason and a new date or a decision.</CardDescription>
        </CardHeader>
        <CardContent>
          {c ? (
            <p className="text-sm">
              Marked as a commitment, due {fmtDate(c.due_date)}. Status: <Badge variant="neutral">{c.status.replace(/_/g, " ")}</Badge>
            </p>
          ) : (
            <form action={markCommitment} className="flex flex-col gap-2">
              <input type="hidden" name="record_type" value={p.table} />
              <input type="hidden" name="record_id" value={p.row.id} />
              <Input type="date" name="due_date" defaultValue={p.row.due_date ?? p.row.deadline ?? ""} required aria-label="Commitment due date" />
              <SubmitButton size="sm" variant="outline">
                Mark as commitment
              </SubmitButton>
            </form>
          )}
        </CardContent>
      </Card>,
    );
  }
  if (p.table === "recurring_series") {
    panels.push(
      <Card key="review">
        <CardHeader>
          <CardTitle>Subscription review</CardTitle>
          <CardDescription>Recurring software charges are marked for review. Record whether this one is still used.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          {[
            ["in_use", "Still in use"],
            ["cancel_planned", "Plan to cancel"],
            ["cancelled", "Cancelled"],
          ].map(([v, l]) => (
            <form key={v} action={setRecurringReview}>
              <input type="hidden" name="id" value={p.row.id} />
              <input type="hidden" name="review_status" value={v} />
              <SubmitButton size="sm" variant={p.row.review_status === v ? "default" : "outline"} className="w-full">
                {l}
              </SubmitButton>
            </form>
          ))}
        </CardContent>
      </Card>,
    );
  }
  if (p.table === "decision_conditions") {
    panels.push(
      <Card key="check">
        <CardContent className="flex flex-col gap-2 pt-5">
          <p className="text-sm text-muted-foreground">Last checked: {p.row.last_evaluated_at ? dateTime(p.row.last_evaluated_at) : "not yet"}.</p>
          <form action={checkConditionsNow}>
            <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Checking...">
              Check all conditions now
            </SubmitButton>
          </form>
        </CardContent>
      </Card>,
    );
  }
  if (p.table === "accounts") {
    panels.push(
      <Card key="bal">
        <CardHeader>
          <CardTitle>Record balance</CardTitle>
        </CardHeader>
        <CardContent>
          <RecordForm table="account_balances" initial={{ account_id: p.row.id, as_of: p.today, source: "manual" }} refOptions={{ accounts: [{ id: p.row.id, label: p.row.name }] }} redirectTo={recordHref("accounts", p.row.id)} only={["as_of", "balance", "account_id"]} submitLabel="Save balance" />
        </CardContent>
      </Card>,
    );
  }
  return <>{panels}</>;
}

async function PipelineItemPanels({ sb, row, refOptions }: P) {
  const [{ data: pipe }, { data: stages }, { data: history }] = await Promise.all([
    sb.from("pipelines").select("*").eq("id", row.pipeline_id).single(),
    sb.from("pipeline_stages").select("*").eq("pipeline_id", row.pipeline_id).order("position"),
    sb.from("stage_history").select("*").eq("item_id", row.id).order("entered_at"),
  ]);
  const stageList = (stages ?? []) as Row[];
  const stageName = Object.fromEntries(stageList.map((s) => [s.id, s.name]));
  const detailTable = pipe?.kind === "acquisition" ? "deal_financials" : pipe?.kind === "job" ? "job_details" : pipe?.kind === "investor" ? "investor_details" : null;
  let detail: Row | null = null;
  if (detailTable) {
    const view = detailTable === "deal_financials" ? "deal_financials_calculated" : detailTable;
    detail = ((await sb.from(view).select("*").eq("item_id", row.id).maybeSingle()).data as Row | null) ?? null;
  }
  const scenarios = refOptions.scenarios ?? ((await sb.from("scenarios").select("id,name")).data ?? []).map((s: Row) => ({ id: s.id, label: s.name }));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Stage</CardTitle>
          <CardDescription>The date the item entered each stage is recorded, so the app shows how long each stage takes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={moveStage} className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="item_id" value={row.id} />
            <NativeSelect name="stage_id" defaultValue={row.stage_id ?? ""} aria-label="Stage" className="sm:max-w-xs">
              {stageList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.position}. {s.name}
                </option>
              ))}
            </NativeSelect>
            <SubmitButton size="sm" variant="outline">
              Move to stage
            </SubmitButton>
          </form>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Stage</TH>
                <TH>Entered</TH>
                <TH>Left</TH>
                <TH className="text-right">Days</TH>
              </TR>
            </THead>
            <TBody>
              {((history ?? []) as Row[]).map((h) => (
                <TR key={h.id}>
                  <TD>{stageName[h.stage_id] ?? "Removed stage"}</TD>
                  <TD>{fmtDate(h.entered_at.slice(0, 10))}</TD>
                  <TD>{h.exited_at ? fmtDate(h.exited_at.slice(0, 10)) : "Current"}</TD>
                  <TD className="tabular text-right">{daysBetween(h.entered_at.slice(0, 10), (h.exited_at ?? new Date().toISOString()).slice(0, 10))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {detailTable && detail ? (
        <Card>
          <CardHeader>
            <CardTitle>{detailTable === "deal_financials" ? "Deal financials and your equity terms" : detailTable === "job_details" ? "Compensation" : "Investment amounts"}</CardTitle>
            {detailTable === "deal_financials" ? (
              <CardDescription>
                Multiple (asking price divided by EBITDA) is calculated: {detail.ebitda_multiple !== null && detail.ebitda_multiple !== undefined ? `${num(detail.ebitda_multiple, 2)}x` : "add asking price and EBITDA"}.
                {detail.sde_multiple ? ` SDE multiple: ${num(detail.sde_multiple, 2)}x.` : ""}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <RecordForm
              table={detailTable}
              id={detail.id}
              initial={detail}
              refOptions={{ scenarios, pipeline_items: [{ id: row.id, label: row.name }] }}
              redirectTo={recordHref("pipeline_items", row.id)}
              only={(detailTable === "deal_financials"
                ? ["asking_price", "revenue", "ebitda", "sde", "salary", "equity_pct", "financing_structure", "vesting_terms", "earn_out_terms", "profit_share_terms", "scenario_id"]
                : detailTable === "job_details"
                  ? ["salary", "bonus", "benefits", "equity_notes", "scenario_id"]
                  : ["amount_discussed", "amount_committed", "terms"])}
              submitLabel="Save"
            />
            {detail.scenario_id ? (
              <Button asChild size="sm" variant="outline" className="self-start">
                <Link href={`/plan/scenarios/${detail.scenario_id}`}>Open the job vs acquisition scenario</Link>
              </Button>
            ) : (detailTable === "deal_financials" || detailTable === "job_details") ? (
              <p className="text-xs text-muted-foreground">Create a job vs acquisition scenario in Plan, Scenarios, then link it here.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {detailTable === "deal_financials" ? <DiligenceList sb={sb} itemId={row.id} /> : null}
    </>
  );
}

async function DiligenceList({ sb, itemId }: { sb: SupabaseClient; itemId: string }) {
  const { data } = await sb.from("diligence_items").select("*").eq("item_id", itemId).order("sort_order");
  const items = (data ?? []) as Row[];
  const doneCount = items.filter((i) => i.is_done).length;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Diligence checklist</CardTitle>
          <CardDescription>
            {doneCount} of {items.length} done
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/records/diligence_items/new?item_id=${itemId}`}>Add item</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-1.5">
                <form action={toggleDiligence}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="is_done" value={String(!i.is_done)} />
                  <button className={`h-5 w-5 rounded border ${i.is_done ? "border-teal-700 bg-teal-700" : "border-slate-400"}`} aria-label={i.is_done ? "Mark not done" : "Mark done"} />
                </form>
                <Link href={recordHref("diligence_items", i.id)} className={`clamp-1 flex-1 text-sm hover:underline ${i.is_done ? "text-muted-foreground line-through" : ""}`}>
                  {i.title}
                </Link>
                {i.due_date ? <span className="text-xs text-muted-foreground">{fmtDate(i.due_date)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No checklist items yet. Add items such as quality of earnings, customer concentration, and lease review.</p>
        )}
      </CardContent>
    </Card>
  );
}

async function FundingPanel({ sb, row }: P) {
  const { data } = await sb.from("repayment_schedules").select("*").eq("funding_source_id", row.id).order("due_date");
  const rows = (data ?? []) as Row[];
  const due = rows.reduce((s, r) => s + Number(r.amount_due), 0);
  const paid = rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
  const principalPaid = rows.reduce((s, r) => s + Math.min(Number(r.paid_amount ?? 0), Number(r.principal ?? 0)), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repayment tracking</CardTitle>
        <CardDescription>Payments due, payments made, and remaining balance.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Total scheduled" value={money(due)} />
          <Stat label="Paid to date" value={money(paid)} />
          <Stat label="Remaining principal" value={money(Math.max(0, Number(row.amount) - principalPaid))} />
          <Stat label="Payments overdue" value={rows.filter((r) => r.due_date < new Date().toISOString().slice(0, 10) && Number(r.paid_amount) < Number(r.amount_due)).length} />
        </div>
        {row.kind === "loan" ? (
          <form action={generateRepayments} className="flex flex-col gap-1">
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton size="sm" variant="outline" className="self-start">
              {rows.length ? "Recreate unpaid schedule from the terms" : "Create repayment schedule from the terms"}
            </SubmitButton>
            <p className="text-xs text-muted-foreground">Uses the amount, interest rate, term, start date, and repayment schedule above. Paid rows are kept.</p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function DecisionPanel({ sb, row }: P) {
  const { data } = await sb.from("decision_options").select("*").eq("decision_id", row.id).order("sort_order");
  const opts = (data ?? []) as Row[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Options</CardTitle>
        <CardDescription>{row.status === "open" ? "Choose one option. You can record the outcome now or later." : "This decision is recorded."}</CardDescription>
      </CardHeader>
      <CardContent>
        {opts.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {opts.map((o) => (
              <div key={o.id} className={`flex flex-col gap-2 rounded-lg border p-3 ${row.chosen_option_id === o.id ? "border-teal-600 bg-teal-50/50" : "border-border"}`}>
                <p className="font-medium">{o.label}</p>
                {o.description ? <p className="text-sm text-muted-foreground">{o.description}</p> : null}
                {o.numbers ? <p className="whitespace-pre-wrap text-sm">{o.numbers}</p> : null}
                {row.status === "open" ? (
                  <form action={chooseOption} className="mt-auto flex flex-col gap-2">
                    <input type="hidden" name="decision_id" value={row.id} />
                    <input type="hidden" name="option_id" value={o.id} />
                    <Textarea name="outcome" rows={2} placeholder="Outcome or reason (optional)" />
                    <SubmitButton size="sm">Choose this option</SubmitButton>
                  </form>
                ) : row.chosen_option_id === o.id ? (
                  <Badge variant="success" className="self-start">
                    Chosen
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No options yet." body="Add the options considered and the numbers for each." action={<Button asChild size="sm"><Link href={`/records/decision_options/new?decision_id=${row.id}`}>Add option</Link></Button>} />
        )}
      </CardContent>
    </Card>
  );
}

async function ReductionPanel({ sb, table, row, labels }: P) {
  if (table === "transactions" && Number(row.amount) >= 0) return null;
  const col = table === "transactions" ? "transaction_id" : "recurring_series_id";
  const { data } = await sb.from("ai_proposals").select("*").eq("table_name", "reduction_actions").eq("status", "pending").filter(`payload->>${col}`, "eq", row.id).order("created_at");
  const pending = (data ?? []) as Row[];
  const back = recordHref(table, row.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reduction actions</CardTitle>
        <CardDescription>3 AI suggestions with estimated monthly savings. Choose one, set a deadline, and track projected vs actual savings.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pending.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {pending.map((p) => (
              <ProposalCard key={p.id} p={p} back={back} labels={labels} />
            ))}
          </div>
        ) : (
          <form action={requestReductionSuggestions} className="flex flex-col gap-2">
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton size="sm" className="self-start" pendingText="Asking the AI..." disabled={!isAIConfigured()}>
              Get 3 suggestions
            </SubmitButton>
            {!isAIConfigured() ? <p className="text-xs text-muted-foreground">The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel, or add a reduction action by hand below.</p> : null}
          </form>
        )}
        <Button asChild size="sm" variant="outline" className="self-start">
          <Link href={`/records/reduction_actions/new?${col}=${row.id}${row.category_id ? `&category_id=${row.category_id}` : ""}`}>Add a reduction action by hand</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

async function InputHistoryPanel({ sb, row }: P) {
  const { data } = await sb.from("input_history").select("*").eq("input_id", row.id).order("changed_at", { ascending: false }).limit(50);
  const rows = (data ?? []) as Row[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>History of past values</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Changed</TH>
                <TH>Old value</TH>
                <TH>New value</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((h) => (
                <TR key={h.id}>
                  <TD>{dateTime(h.changed_at)}</TD>
                  <TD className="tabular">{h.old_number ?? h.old_text ?? "empty"}</TD>
                  <TD className="tabular">{h.new_number ?? h.new_text ?? "empty"}</TD>
                  <TD>{h.actor === "ai" ? "AI (approved)" : h.actor === "system" ? "Scheduled job" : "Owner"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">This value has not changed since it was set.</p>
        )}
      </CardContent>
    </Card>
  );
}

async function GoalProgress({ sb, row, today }: P) {
  if (!row.metric_key) return null;
  const metrics = await computeMetrics(sb, today);
  const current = metrics.values[row.metric_key] ?? null;
  const met = current !== null && row.target_value !== null && (row.comparison === "lte" ? current <= Number(row.target_value) : current >= Number(row.target_value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Measured number</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Current value (calculated)" value={current === null ? "Not available" : num(current, 2)} tone={met ? "good" : undefined} />
          <Stat label="Target" value={row.target_value ?? "Not set"} />
          <Stat label="Deadline" value={fmtDate(row.deadline)} />
        </div>
        {met ? <p className="mt-3 text-sm text-emerald-700">The measured number meets the target. Mark the goal met when confirmed.</p> : null}
      </CardContent>
    </Card>
  );
}

async function PartnerLinksPanel({ sb, row }: P) {
  const { data } = await sb.from("partner_links").select("*").eq("partner_id", row.id).order("created_at", { ascending: false });
  const links = (data ?? []) as Row[];
  const now = new Date().toISOString();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Private report links</CardTitle>
        <CardDescription>A private web link with no login. It shows only the sections chosen for this accountability partner. Each link can be revoked or set to expire.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {links.length ? (
          <ul className="flex flex-col gap-2">
            {links.map((l) => {
              const active = !l.revoked_at && (!l.expires_at || l.expires_at > now);
              let url: string | null = null;
              if (active && l.token_encrypted) {
                try {
                  url = `${env.appUrl}/report/${decrypt(l.token_encrypted)}`;
                } catch {
                  url = null;
                }
              }
              return (
                <li key={l.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {l.label ?? "Link"} <Badge variant={active ? "success" : "neutral"}>{active ? "Active" : l.revoked_at ? "Revoked" : "Expired"}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {dateTime(l.created_at)}
                      {l.expires_at ? `. Expires ${dateTime(l.expires_at)}` : ". Does not expire"}
                      {l.last_viewed_at ? `. Last viewed ${dateTime(l.last_viewed_at)}` : ". Not viewed yet"}
                    </p>
                    {url ? <p className="mt-1 break-all font-mono text-xs text-slate-700">{url}</p> : null}
                  </div>
                  {active ? (
                    <form action={revokePartnerLink}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton size="sm" variant="outline">
                        Revoke
                      </SubmitButton>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice>No link yet. Create one to share reports without a login.</Notice>
        )}
        <form action={createPartnerLink} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <input type="hidden" name="partner_id" value={row.id} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="clamp-1">Label (optional)</span>
            <Input name="label" placeholder="Example: Weekly report link" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="clamp-1">Expires after</span>
            <NativeSelect name="expires_days" defaultValue="0">
              <option value="0">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </NativeSelect>
          </label>
          <SubmitButton size="sm">Create link</SubmitButton>
        </form>
        <form action={createReportNow}>
          <input type="hidden" name="partner_id" value={row.id} />
          <SubmitButton size="sm" variant="outline" pendingText="Creating report...">
            Create a report now
          </SubmitButton>
        </form>
        <DetailGrid items={[{ label: "Report schedule", value: row.schedule }, { label: "Next report date", value: fmtDate(row.next_report_on) }]} />
      </CardContent>
    </Card>
  );
}

/** Contact page: relationship group, outreach frequency, last contact, next due date, and outreach history with outcomes. */
async function ContactOutreachPanel({ sb, ownerId, row, today }: P) {
  const back = `/records/contacts/${row.id}`;
  const [{ data: profile }, comms] = await Promise.all([
    sb.from("owner_profile").select("timezone").eq("owner_id", ownerId).maybeSingle(),
    sb.from("communications").select("id,occurred_at,method,subject,summary,is_outreach,outcome").eq("contact_id", row.id).order("occurred_at", { ascending: false }).limit(50),
  ]);
  if (comms.error && isMissingSchemaError(comms.error)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Outreach</CardTitle>
        </CardHeader>
        <CardContent>
          <DbUpdateNotice compact />
        </CardContent>
      </Card>
    );
  }
  const tz = (profile as Row | null)?.timezone || "America/New_York";
  const list = (comms.data ?? []) as Row[];
  const last = list[0] ? todayInTz(tz, new Date(list[0].occurred_at)) : null;
  const status = outreachStatus(row, last, today);
  const outreach = list.filter((c) => c.is_outreach);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outreach</CardTitle>
        <CardDescription>The last contact date comes from the latest communication. Set the relationship group with Edit.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Relationship group" value={row.relationship_group ? GROUP_LABELS[row.relationship_group as RelationshipGroup] : "Not set"} />
          <Stat label="Reach out every" value={status.everyDays ? `${status.everyDays} days` : "Not set"} hint={row.outreach_every_days ? "Set on this contact" : row.relationship_group ? "Group default" : undefined} />
          <Stat label="Last contact" value={last ? fmtDate(last, "MMM d") : "Never"} />
          <Stat
            label="Next message due"
            value={status.neverContacted ? (status.due ? "Now" : "Not set") : status.dueDate ? fmtDate(status.dueDate, "MMM d") : "Not set"}
            tone={status.due ? "warn" : undefined}
            hint={status.due && status.daysOverdue ? `${status.daysOverdue} days overdue` : undefined}
          />
        </div>
        <LogOutreachButton contactId={row.id} back={back} />
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Outreach history and outcomes</p>
          {outreach.length ? (
            <ul className="flex flex-col divide-y divide-slate-100">
              {outreach.map((c) => (
                <li key={c.id} className="grid grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_12rem]">
                  <span className="tabular text-xs text-muted-foreground">
                    {fmtDate(c.occurred_at, "MMM d, yyyy")} . {c.method}
                  </span>
                  <Link href={recordHref("communications", c.id)} className="clamp-1 text-sm hover:underline">
                    {c.summary || c.subject || "Outreach"}
                  </Link>
                  <form action={setOutreachOutcome} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="back" value={back} />
                    <NativeSelect name="outcome" defaultValue={c.outcome ?? ""} aria-label="Outcome" className="h-8 text-xs">
                      <option value="">No outcome yet</option>
                      {OUTCOME_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <SubmitButton size="sm" variant="outline" className="h-8 px-2 text-xs">
                      Save
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No outreach logged for this contact yet.</p>
          )}
          {outreach.some((c) => c.outcome) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Outcomes: {Object.entries(OUTCOME_LABELS).map(([k, l]) => `${l} ${outreach.filter((c) => c.outcome === k).length}`).join(", ")}.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Target page: history grid and current numbers. */
async function TargetHistoryPanel({ sb, ownerId, row, today }: P) {
  const { data: profile } = await sb.from("owner_profile").select("timezone").eq("owner_id", ownerId).maybeSingle();
  const data = await loadTargets(sb, { ownerId, tz: (profile as Row | null)?.timezone || "America/New_York", from: addDaysISO(today, -182), to: today, includeInactive: true });
  const s = summarizeTargets(data, today).find((x) => x.target.id === row.id);
  if (!s) return null;
  const unit = s.target.period === "week" ? "Weeks" : "Days";
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>{describeTarget(s.target.def)}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={s.target.period === "week" ? "This week so far" : "Today"} value={s.today.status === "off" ? "Not counted" : `${s.today.count} of ${s.today.required}`} />
          <Stat label="Completion rate" value={s.rate.pct === null ? "No data yet" : `${s.rate.pct}%`} />
          <Stat label={`${unit} met in a row`} value={s.metInARow} />
          <Stat label={`${unit} missed in a row`} value={s.missedInARow} />
        </div>
        {s.target.period === "week" ? <TargetWeekGrid history={s.history} today={today} /> : <TargetDayGrid history={s.history} today={today} />}
        <TargetLegend />
      </CardContent>
    </Card>
  );
}
