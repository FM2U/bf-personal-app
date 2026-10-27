import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Badge, dueClass } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SubmitButton } from "@/components/app/submit-button";
import { DetailGrid, EmptyState, Notice, Stat, StatGrid } from "@/components/app/page-header";
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
import { computeMetrics, metricValue } from "@/lib/metrics";
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
import { DETAIL_TABLE, loadPipelineStatus, missingForStage, hasPipelineUpdate } from "@/lib/pipeline";
import { effectiveProbability, expectedIncomeGap, expectedMonthlyIncome, paymentSummary, RATE_TYPE_LABELS, type RateType } from "@/lib/calc/consulting";
import { creditByContact, introducedNote } from "@/lib/calc/source-chain";
import { fieldTextForKind } from "@/lib/pipeline-labels";
import { DB_UPDATE_FILE_0011 } from "@/lib/schema-guard";
import { hasConsultingUpdate } from "@/lib/consulting";
import { fetchAll } from "@/lib/data";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";
import { TaskList } from "@/components/app/task-list";
import { logDealActivity } from "@/app/actions/pipeline";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { OrgPeopleAddForm, type PersonOption } from "@/components/app/org-people";
import { unlinkOrgPerson } from "@/app/actions/people";
import { optionExclusions } from "@/lib/form-rules";
import { ChecklistCard, loadChecklists, PlanDocumentCard } from "@/components/app/checklist-panel";
import { hasUpdate0014 } from "@/lib/update-0014";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";

type P = {
  sb: SupabaseClient;
  ownerId: string;
  table: string;
  row: Row;
  today: string;
  labels: Record<string, Record<string, string>>;
  refOptions: Record<string, RefOption[]>;
  sp?: Record<string, string>;
};

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
      return (
        <>
          <ContactCreditPanel {...p} />
          <ContactOutreachPanel {...p} />
        </>
      );
    case "targets":
      return <TargetHistoryPanel {...p} />;
    case "initiatives":
      return <InitiativePlanPanels {...p} />;
    case "tasks":
      return <TaskChecklists {...p} />;
    case "organizations":
      // While editing, the form has its own "People at this organization" section.
      return p.sp?.edit === "1" ? null : <OrgPeoplePanel {...p} />;
    default:
      return null;
  }
}

/** Organization page: its people (contacts linked to it) with Unlink, and a form to add existing contacts or new people. */
async function OrgPeoplePanel({ sb, row, refOptions }: P) {
  const [{ data }, exclude] = await Promise.all([
    sb.from("contacts").select("id,name,title,email,phone").eq("organization_id", row.id).order("name"),
    optionExclusions(sb),
  ]);
  const people = (data ?? []) as Row[];
  return (
    <Card id="people">
      <CardHeader>
        <CardTitle>People at this organization</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {people.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[36rem] table-fixed">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="w-[28%]">Name</TH>
                  <TH className="w-[24%]">Job title or role</TH>
                  <TH>Email and phone</TH>
                  <TH className="w-[6.5rem]">
                    <span className="sr-only">Unlink</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {people.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={recordHref("contacts", c.id)} className="clamp-2 font-medium hover:underline">
                        {c.name}
                      </Link>
                    </TD>
                    <TD>
                      <span className="clamp-2">{c.title ?? <span className="text-muted-foreground">Not set</span>}</span>
                    </TD>
                    <TD>
                      <span className="clamp-1">{c.email ?? ""}</span>
                      {c.phone ? <span className="clamp-1 text-xs text-muted-foreground">{c.phone}</span> : null}
                    </TD>
                    <TD className="text-right">
                      <GuardedForm action={unlinkOrgPerson}>
                        <input type="hidden" name="organization_id" value={row.id} />
                        <input type="hidden" name="contact_id" value={c.id} />
                        <SubmitButton size="sm" variant="outline" pendingText="Unlinking..." aria-label={`Unlink ${c.name}`}>
                          Unlink
                        </SubmitButton>
                      </GuardedForm>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No people linked yet.</p>
        )}
        <div className="border-t border-slate-200 pt-4">
          <p className="mb-3 text-sm font-semibold text-slate-900">Add people</p>
          <OrgPeopleAddForm
            organizationId={row.id}
            contacts={(refOptions.contacts ?? []) as PersonOption[]}
            organizations={Object.fromEntries((refOptions.organizations ?? []).map((o) => [o.id, o.label]))}
            excludeGroups={exclude["contacts.relationship_group"]}
          />
        </div>
      </CardContent>
      <CardNote>Unlink removes a person from this organization only. The contact is kept.</CardNote>
    </Card>
  );
}

/** Record-specific panels shown in the side column. */
export async function ExtraSidePanels(p: P) {
  const panels: React.ReactNode[] = [];
  if (p.table === "tasks") {
    panels.push(
      <Card key="task">
        <CardContent className="flex flex-col gap-2 pt-5">
          <GuardedForm
            action={async () => {
              "use server";
              await setTaskStatus(p.row.id, p.row.status !== "done");
            }}
          >
            <SubmitButton size="sm" variant={p.row.status === "done" ? "outline" : "default"} className="w-full">
              {p.row.status === "done" ? "Mark as not done" : "Mark as done"}
            </SubmitButton>
          </GuardedForm>
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
          <GuardedForm action={completeMilestone} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={p.row.id} />
            <Input name="proof" placeholder={p.row.proof_type === "link" ? "Link to proof" : p.row.proof_type === "number" ? "Number achieved" : "Optional note (upload the document below)"} defaultValue={p.row.proof_value ?? ""} />
            <SubmitButton size="sm">Mark met</SubmitButton>
          </GuardedForm>
        </CardContent>
      </Card>,
    );
  }
  if (p.table === "pipeline_items" && p.row.status === "open") {
    const { data: pipe } = await p.sb.from("pipelines").select("kind").eq("id", p.row.pipeline_id).maybeSingle();
    if ((pipe as Row | null)?.kind === "acquisition") panels.push(<DealActivityCard key="deal-activity" row={p.row} available={await hasPipelineUpdate(p.sb)} />);
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
            <GuardedForm action={markCommitment} className="flex flex-col gap-2">
              <input type="hidden" name="record_type" value={p.table} />
              <input type="hidden" name="record_id" value={p.row.id} />
              <Input type="date" name="due_date" defaultValue={p.row.due_date ?? p.row.deadline ?? ""} required aria-label="Commitment due date" />
              <SubmitButton size="sm" variant="outline">
                Mark as commitment
              </SubmitButton>
            </GuardedForm>
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
            <GuardedForm key={v} action={setRecurringReview}>
              <input type="hidden" name="id" value={p.row.id} />
              <input type="hidden" name="review_status" value={v} />
              <SubmitButton size="sm" variant={p.row.review_status === v ? "default" : "outline"} className="w-full">
                {l}
              </SubmitButton>
            </GuardedForm>
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
          <GuardedForm action={checkConditionsNow}>
            <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Checking...">
              Check all conditions now
            </SubmitButton>
          </GuardedForm>
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
          <RecordForm table="account_balances" initial={{ account_id: p.row.id, as_of: p.today, source: "manual" }} refOptions={{ accounts: [{ id: p.row.id, label: p.row.name }] }} redirectTo={recordHref("accounts", p.row.id)} only={["as_of", "balance", "account_id"]} submitLabel="Save balance" allowCreate={false} />
        </CardContent>
      </Card>,
    );
  }
  return <>{panels}</>;
}

/** Notices at the top of a pipeline item page: a stage move blocked by missing details, or a saved action. */
export async function PipelineItemNotices({ sb, row, sp }: { sb: SupabaseClient; row: Row; sp: Record<string, string> }) {
  const { data: blocked } = sp.blocked ? await sb.from("pipeline_stages").select("id,name").eq("id", sp.blocked).maybeSingle() : { data: null };
  const blockedStage = blocked as Row | null;
  const blockedMissing = blockedStage ? await missingForStage(sb, row, blockedStage.id) : [];
  if (!sp.notice && !(blockedStage && blockedMissing.length)) return null;
  return (
    <div className="mb-4 flex flex-col gap-3">
      {sp.notice ? <Notice tone={sp.notice.startsWith("Database update") || sp.notice.startsWith("Not saved") ? "warn" : "success"}>{sp.notice}</Notice> : null}
      {blockedStage && blockedMissing.length ? (
        <Notice tone="error">
          <p className="font-medium">Not moved to {blockedStage.name}. Add these details first:</p>
          <ul className="mt-1 list-disc pl-5">
            {blockedMissing.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
          <a href={["deal_source_type", "primary_contact_id", "organization_id"].some((k) => blockedMissing.some((m) => m.key === k)) ? "?edit=1#details" : "#item-details"} className="mt-2 inline-block font-medium underline">
            Fill them in now
          </a>
        </Notice>
      ) : null}
    </div>
  );
}

async function PipelineItemPanels({ sb, ownerId, row, refOptions, today }: P) {
  const [{ data: pipe }, { data: stages }, { data: history }, { data: profile }] = await Promise.all([
    sb.from("pipelines").select("*").eq("id", row.pipeline_id).single(),
    sb.from("pipeline_stages").select("*").eq("pipeline_id", row.pipeline_id).order("position"),
    sb.from("stage_history").select("*").eq("item_id", row.id).order("entered_at"),
    sb.from("owner_profile").select("timezone").eq("owner_id", ownerId).maybeSingle(),
  ]);
  const stageList = (stages ?? []) as Row[];
  const tz = (profile as Row | null)?.timezone || "America/New_York";
  const status = await loadPipelineStatus(sb, [row], { ownerId, tz, today, stages: stageList });
  const st = status.byItem[row.id];
  const current = stageList.find((s) => s.id === row.stage_id);
  const nextStage = stageList.find((s) => s.outcome !== "lost" && Number(s.position) > Number(current?.position ?? 0));
  const nextMissing = nextStage && row.status === "open" ? await missingForStage(sb, row, nextStage.id) : [];
  const { data: stageTasksData } = await sb.from("tasks").select("*").eq("pipeline_item_id", row.id).like("source_key", `stage-task:${row.id}:%`).order("due_date");
  const stageTasks = ((stageTasksData ?? []) as Row[]).filter((t) => t.status !== "skipped");
  const isAcq = pipe?.kind === "acquisition";
  const isConsulting = pipe?.kind === "consulting";
  const stageName = Object.fromEntries(stageList.map((s) => [s.id, s.name]));
  const detailTable = DETAIL_TABLE[String(pipe?.kind ?? "")] ?? null;
  let detail: Row | null = null;
  if (detailTable) {
    const view = detailTable === "deal_financials" ? "deal_financials_calculated" : detailTable;
    detail = ((await sb.from(view).select("*").eq("item_id", row.id).maybeSingle()).data as Row | null) ?? null;
    // An item created before its details row existed (example: right after update 0011) gets one now.
    if (!detail && detailTable === "consulting_details" && (await hasConsultingUpdate(sb))) {
      detail = ((await sb.from("consulting_details").insert({ owner_id: ownerId, item_id: row.id }).select("*").maybeSingle()).data as Row | null) ?? null;
    }
  }
  const text = fieldTextForKind(pipe?.kind);
  const scenarios = refOptions.scenarios ?? ((await sb.from("scenarios").select("id,name")).data ?? []).map((s: Row) => ({ id: s.id, label: s.name }));
  const limitText = !st?.limit
    ? "No time limit for this stage"
    : st.limit.limit === null
      ? `${st.limit.daysInStage} days. No time limit for this stage`
      : `Day ${st.limit.daysInStage} of ${st.limit.limit}${st.limit.extensionDays ? ` (stage limit ${current?.max_days_in_stage} plus ${st.limit.extensionDays} extension days)` : ""}`;
  const chainIds = [row.source_contact_id, row.introduced_by_contact_id].filter(Boolean) as string[];
  const chainContacts = chainIds.length ? (((await sb.from("contacts").select("id,name").in("id", chainIds)).data ?? []) as Row[]) : [];
  const contactLink = (id: string | null | undefined) => {
    const c = chainContacts.find((x) => x.id === id);
    return c ? (
      <Link href={recordHref("contacts", c.id)} className="hover:underline">
        {c.name}
      </Link>
    ) : (
      "None"
    );
  };
  const showChain = isAcq || isConsulting;
  const introducedAvailable = row.introduced_by_contact_id !== undefined;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Accountability
            {isAcq ? <DealSourceBadge type={row.deal_source_type} /> : null}
            <ItemStatusBadges status={st} itemStatus={row.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!status.available ? <DbUpdateNotice compact /> : null}
          <DetailGrid
            cols={2}
            items={[
              {
                label: "Next action",
                value: row.next_action ? (
                  <span className={dueClass(row.next_action_due, today)}>
                    {row.next_action}
                    {row.next_action_due ? ` (due ${fmtDate(row.next_action_due)})` : ""}
                  </span>
                ) : (
                  <Link href="?edit=1" className="font-medium text-status-soon underline">
                    Not set. Set it now
                  </Link>
                ),
              },
              { label: "Time in this stage", value: <span className={st?.limit?.over ? "font-medium text-status-missed" : ""}>{limitText}</span> },
              {
                label: "Last activity",
                value: st?.lastActivity ? (
                  <span className={st.stalled ? "font-medium text-status-soon" : ""}>
                    {fmtDate(st.lastActivity)} ({st.daysSinceActivity === 0 ? "today" : `${st.daysSinceActivity} days ago`})
                  </span>
                ) : (
                  "None"
                ),
              },
              {
                label: nextStage ? `Needed before ${nextStage.name}` : "Needed before the next stage",
                value: !nextStage || row.status !== "open" ? "No later stage" : nextMissing.length ? <span className="font-medium text-status-soon">{nextMissing.map((m) => m.label).join(", ")}</span> : "Nothing missing",
              },
              ...(isAcq
                ? [{ label: "Deal source", value: row.deal_source_type ? <DealSourceBadge type={row.deal_source_type} /> : status.available ? <Link href="?edit=1" className="text-status-soon underline">Not set</Link> : "Not available yet" }]
                : []),
              ...(showChain
                ? [
                    { label: text.source_contact_id?.label ?? "Deal came from", value: row.source && row.source_contact_id ? <>{contactLink(row.source_contact_id)} (also noted: {row.source})</> : row.source ? `${row.source} (not a person)` : contactLink(row.source_contact_id) },
                    { label: "Introduced by", value: introducedAvailable ? contactLink(row.introduced_by_contact_id) : "Not available yet" },
                  ]
                : []),
            ]}
          />
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks from the stage task lists</p>
            {stageTasks.length ? (
              <TaskList tasks={stageTasks} today={today} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {status.available ? "No stage tasks for this item yet. They are created when the item enters a stage that has a task list." : "Stage task lists appear after the database update."}
              </p>
            )}
          </div>
        </CardContent>
        <CardNote>Every open item has a next action, a time limit for its stage, and the stage&apos;s task list.</CardNote>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Stage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <GuardedForm action={moveStage} className="flex flex-col gap-2 sm:flex-row">
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
          </GuardedForm>
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
        <CardNote>The date the item entered each stage is recorded, so the app shows how long each stage takes.</CardNote>
      </Card>
      {detailTable === "consulting_details" ? (
        detail ? <ConsultingTermsPanel sb={sb} row={row} detail={detail} stage={current ?? null} /> : <Card id="item-details"><CardContent className="pt-5"><DbUpdateNotice compact file={DB_UPDATE_FILE_0011} /></CardContent></Card>
      ) : null}
      {detailTable && detailTable !== "consulting_details" && detail ? (
        <Card id="item-details">
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

/** Consulting item: engagement terms (rate type, rate, hours, dates, probability), calculated income, and payments received. */
async function ConsultingTermsPanel({ sb, row, detail, stage }: { sb: SupabaseClient; row: Row; detail: Row; stage: Row | null }) {
  const expected = expectedMonthlyIncome(detail);
  const gap = expectedIncomeGap(detail);
  const prob = effectiveProbability(detail.probability_pct, stage?.default_probability_pct);
  const probSource = detail.probability_pct !== null && detail.probability_pct !== undefined ? "Set on this item" : stage?.default_probability_pct !== null && stage?.default_probability_pct !== undefined ? `Stage default (${stage?.name})` : "No default for this stage";
  let payments: Row[] = [];
  try {
    payments = await fetchAll((a, b) => sb.from("transactions").select("id,date,amount,description,merchant_name").eq("pipeline_item_id", row.id).order("date", { ascending: false }).range(a, b));
  } catch {
    payments = [];
  }
  const paid = paymentSummary(payments.map((p) => ({ date: p.date, amount: p.amount })));
  return (
    <>
      <Card id="item-details">
        <CardHeader>
          <CardTitle>Engagement terms</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <StatGrid className="sm:grid-cols-3">
            <Stat label="Expected monthly income (calculated)" value={expected === null ? "Not calculated" : money(expected)} hint={gap ?? (detail.rate_type ? RATE_TYPE_LABELS[detail.rate_type as RateType] : undefined)} tone={expected === null ? "warn" : undefined} />
            <Stat label="Probability it becomes paid work" value={`${prob}%`} hint={probSource} />
            <Stat label="Weighted monthly value" value={expected === null ? "Not calculated" : money(Math.round(expected * prob) / 100)} hint="Expected monthly income x probability" />
          </StatGrid>
          <RecordForm
            table="consulting_details"
            id={detail.id}
            initial={detail}
            refOptions={{ pipeline_items: [{ id: row.id, label: row.name }] }}
            redirectTo={recordHref("pipeline_items", row.id)}
            only={["rate_type", "rate", "expected_hours_per_month", "project_months", "start_date", "end_date", "probability_pct", "scope_notes"]}
            submitLabel="Save terms"
          />
        </CardContent>
        <CardNote>Hourly: rate x hours per month. Monthly retainer: the rate. Project: the fee divided by the project months (or the months from start to end date).</CardNote>
      </Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle>Payments received</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href={`/records/transactions/new?pipeline_item_id=${row.id}&description=${encodeURIComponent(`Payment: ${row.name}`)}`}>Record a payment</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <StatGrid className="sm:grid-cols-3">
            <Stat label="Payments" value={paid.count} />
            <Stat label="Total received" value={money(paid.total)} tone={paid.total ? "good" : undefined} />
            <Stat label="Last payment" value={paid.lastDate ? fmtDate(paid.lastDate) : "None yet"} />
          </StatGrid>
          {payments.length ? (
            <ul className="flex flex-col divide-y divide-slate-100">
              {payments.slice(0, 12).map((t) => (
                <li key={t.id} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-sm">
                  <span className="tabular text-xs text-muted-foreground">{fmtDate(t.date, "MMM d, yyyy")}</span>
                  <Link href={recordHref("transactions", t.id)} className="clamp-1 hover:underline">
                    {t.merchant_name || t.description}
                  </Link>
                  <span className={`tabular ${Number(t.amount) > 0 ? "text-status-met" : "text-slate-700"}`}>{money(t.amount, true)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No payments linked yet. Open a transaction (money in) and choose this item as its consulting engagement, or press Record a payment.</p>
          )}
        </CardContent>
        <CardNote>Money received linked to this engagement (Finance, Income Received).</CardNote>
      </Card>
    </>
  );
}

/** Quick log on an acquisition item: CIM requested, or contact with the broker or referral source (counted by Deals advanced). */
function DealActivityCard({ row, available }: { row: Row; available: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Log deal activity</CardTitle>
        <CardDescription>Counts toward the Deals advanced target (once per deal per day).</CardDescription>
      </CardHeader>
      <CardContent>
        {available ? (
          <GuardedForm action={logDealActivity} className="flex flex-col gap-2">
            <input type="hidden" name="item_id" value={row.id} />
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              What happened
              <NativeSelect name="purpose" defaultValue="cim_request" aria-label="What happened">
                <option value="cim_request">I requested the CIM</option>
                <option value="source_contact">I contacted the broker or referral source</option>
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Method
              <NativeSelect name="method" defaultValue="email" aria-label="Method">
                <option value="email">Email</option>
                <option value="call">Call</option>
                <option value="text">Text</option>
                <option value="meeting">Meeting</option>
                <option value="other">Other</option>
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Summary (optional)
              <Input name="summary" maxLength={500} placeholder="What you asked for or discussed" />
            </label>
            <SubmitButton size="sm" pendingText="Saving...">
              Log it
            </SubmitButton>
          </GuardedForm>
        ) : (
          <DbUpdateNotice compact />
        )}
      </CardContent>
    </Card>
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
                <GuardedForm action={toggleDiligence}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="is_done" value={String(!i.is_done)} />
                  <button className={`h-5 w-5 rounded border ${i.is_done ? "border-teal-700 bg-teal-700" : "border-slate-400"}`} aria-label={i.is_done ? "Mark not done" : "Mark done"} />
                </GuardedForm>
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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatGrid className="sm:grid-cols-4">
          <Stat label="Total scheduled" value={money(due)} />
          <Stat label="Paid to date" value={money(paid)} />
          <Stat label="Remaining principal" value={money(Math.max(0, Number(row.amount) - principalPaid))} />
          <Stat label="Payments overdue" value={rows.filter((r) => r.due_date < new Date().toISOString().slice(0, 10) && Number(r.paid_amount) < Number(r.amount_due)).length} />
        </StatGrid>
        {row.kind === "loan" ? (
          <GuardedForm action={generateRepayments} className="flex flex-col gap-1">
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton size="sm" variant="outline" className="self-start">
              {rows.length ? "Recreate unpaid schedule from the terms" : "Create repayment schedule from the terms"}
            </SubmitButton>
            <p className="text-xs text-muted-foreground">Uses the amount, interest rate, term, start date, and repayment schedule above. Paid rows are kept.</p>
          </GuardedForm>
        ) : null}
      </CardContent>
      <CardNote>Payments due, payments made, and remaining balance.</CardNote>
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
                  <GuardedForm action={chooseOption} className="mt-auto flex flex-col gap-2">
                    <input type="hidden" name="decision_id" value={row.id} />
                    <input type="hidden" name="option_id" value={o.id} />
                    <Textarea name="outcome" rows={2} placeholder="Outcome or reason (optional)" />
                    <SubmitButton size="sm">Choose this option</SubmitButton>
                  </GuardedForm>
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
          <GuardedForm action={requestReductionSuggestions} className="flex flex-col gap-2">
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton size="sm" className="self-start" pendingText="Asking the AI..." disabled={!isAIConfigured()}>
              Get 3 suggestions
            </SubmitButton>
            {!isAIConfigured() ? <p className="text-xs text-muted-foreground">The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel, or add a reduction action by hand below.</p> : null}
          </GuardedForm>
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
  const current = metricValue(metrics, row.metric_key, row.metric_params);
  const met = current !== null && row.target_value !== null && (row.comparison === "lte" ? current <= Number(row.target_value) : current >= Number(row.target_value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Measured number</CardTitle>
      </CardHeader>
      <CardContent>
        <StatGrid className="grid-cols-3">
          <Stat label="Current value (calculated)" value={current === null ? "Not available" : num(current, 2)} tone={met ? "good" : undefined} />
          <Stat label="Target" value={row.target_value ?? "Not set"} />
          <Stat label="Deadline" value={fmtDate(row.deadline)} />
        </StatGrid>
        {met ? <p className="mt-3 text-sm text-status-met">The measured number meets the target. Mark the goal met when confirmed.</p> : null}
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
                    <GuardedForm action={revokePartnerLink}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton size="sm" variant="outline">
                        Revoke
                      </SubmitButton>
                    </GuardedForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice>No link yet. Create one to share reports without a login.</Notice>
        )}
        <GuardedForm action={createPartnerLink} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <input type="hidden" name="partner_id" value={row.id} />
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <span className="clamp-1">Label (optional)</span>
            <Input name="label" placeholder="Example: Weekly report link" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <span className="clamp-1">Expires after</span>
            <NativeSelect name="expires_days" defaultValue="0">
              <option value="0">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </NativeSelect>
          </label>
          <SubmitButton size="sm">Create link</SubmitButton>
        </GuardedForm>
        <GuardedForm action={createReportNow}>
          <input type="hidden" name="partner_id" value={row.id} />
          <SubmitButton size="sm" variant="outline" pendingText="Creating report...">
            Create a report now
          </SubmitButton>
        </GuardedForm>
        <DetailGrid items={[{ label: "Report schedule", value: row.schedule }, { label: "Next report date", value: fmtDate(row.next_report_on) }]} />
      </CardContent>
    </Card>
  );
}

/** Contact page: deals and consulting leads this contact handed over ("Deal came from") or started ("Introduced by"). */
async function ContactCreditPanel({ sb, row }: P) {
  const [from, intro, pipes, stages] = await Promise.all([
    sb.from("pipeline_items").select("*").eq("source_contact_id", row.id),
    sb.from("pipeline_items").select("*").eq("introduced_by_contact_id", row.id),
    sb.from("pipelines").select("id,name,kind"),
    sb.from("pipeline_stages").select("id,name"),
  ]);
  const available = !(intro.error && isMissingSchemaError(intro.error));
  const kindOf = Object.fromEntries(((pipes.data ?? []) as Row[]).map((p) => [p.id, p.kind]));
  const pipeName = Object.fromEntries(((pipes.data ?? []) as Row[]).map((p) => [p.id, p.name]));
  const stageName = Object.fromEntries(((stages.data ?? []) as Row[]).map((st) => [st.id, st.name]));
  const byId = new Map<string, Row>();
  for (const it of [...((from.data ?? []) as Row[]), ...(available ? ((intro.data ?? []) as Row[]) : [])]) byId.set(it.id, it);
  const items = [...byId.values()].filter((i) => ["acquisition", "consulting"].includes(kindOf[i.pipeline_id]));
  const credit = creditByContact(items.map((i) => ({ id: i.id, kind: kindOf[i.pipeline_id], source_contact_id: i.source_contact_id, introduced_by_contact_id: i.introduced_by_contact_id })))[row.id] ?? {
    deals: 0,
    dealsCameFrom: 0,
    dealsIntroduced: 0,
    consultingLeads: 0,
  };
  const role = (i: Row) =>
    [i.source_contact_id === row.id ? (kindOf[i.pipeline_id] === "consulting" ? "Lead came from" : "Deal came from") : null, i.introduced_by_contact_id === row.id ? "Introduced by" : null].filter(Boolean).join(", ");
  return (
    <Card id="deal-credit">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Deals from this contact
          {introducedNote(credit) ? <Badge variant="default">{introducedNote(credit)}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!available ? <DbUpdateNotice compact file={DB_UPDATE_FILE_0011} /> : null}
        <StatGrid className="sm:grid-cols-4">
          <Stat label="Deals (came from or introduced)" value={credit.deals} />
          <Stat label="Deals: came from this contact" value={credit.dealsCameFrom} />
          <Stat label="Deals: introduced by this contact" value={available ? credit.dealsIntroduced : "Not yet"} />
          <Stat label="Consulting leads" value={available ? credit.consultingLeads : "Not yet"} />
        </StatGrid>
        {items.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.id} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
                <Link href={recordHref("pipeline_items", i.id)} className="clamp-1 font-medium hover:underline">
                  {i.name}
                </Link>
                <span className="clamp-1 text-slate-700">
                  {pipeName[i.pipeline_id]}: {stageName[i.stage_id] ?? "No stage"}
                </span>
                <span className="clamp-1 text-xs text-muted-foreground">{role(i)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No deals or consulting leads list this contact yet.</p>
        )}
      </CardContent>
      <CardNote>Counts acquisition deals and consulting leads where this contact is &quot;Deal came from&quot; (or &quot;Lead came from&quot;) or &quot;Introduced by&quot;. Each item counts once.</CardNote>
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
        <CardTitle className="flex flex-wrap items-center gap-2">
          Outreach
          {row.is_deal_source ? <Badge variant="default">Deal source</Badge> : null}
          {row.is_consulting_lead ? <Badge variant="default">Consulting lead</Badge> : null}
        </CardTitle>
        <CardDescription>The last contact date comes from the latest communication. Set the relationship group, and whether this person can refer off-market deals, with Edit.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatGrid className="sm:grid-cols-4">
          <Stat label="Relationship group" value={row.relationship_group ? GROUP_LABELS[row.relationship_group as RelationshipGroup] : "Not set"} />
          <Stat label="Reach out every" value={status.everyDays ? `${status.everyDays} days` : "Not set"} hint={row.outreach_every_days ? "Set on this contact" : row.relationship_group === "other" ? "Other: no set schedule" : row.relationship_group ? "Group default" : undefined} />
          <Stat label="Last contact" value={last ? fmtDate(last, "MMM d") : "Never"} />
          <Stat
            label="Next message due"
            value={status.neverContacted ? (status.due ? "Now" : "Not set") : status.dueDate ? fmtDate(status.dueDate, "MMM d") : "Not set"}
            tone={status.due ? "warn" : undefined}
            hint={status.due && status.daysOverdue ? `${status.daysOverdue} days overdue` : undefined}
          />
        </StatGrid>
        <LogOutreachButton
          contactId={row.id}
          back={back}
          purposeAvailable={row.is_deal_source !== undefined}
          consultingAvailable={row.is_consulting_lead !== undefined}
          defaultPurpose={row.is_consulting_lead ? "consulting" : row.is_deal_source ? "deal_sourcing" : "general"}
        />
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
                  <GuardedForm action={setOutreachOutcome} className="flex items-center gap-1">
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
                  </GuardedForm>
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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatGrid className="sm:grid-cols-4">
          <Stat label={s.target.period === "week" ? "This week so far" : "Today"} value={s.today.status === "off" ? "Not counted" : `${s.today.count} of ${s.today.required}`} />
          <Stat label="Completion rate" value={s.rate.pct === null ? "No data yet" : `${s.rate.pct}%`} />
          <Stat label={`${unit} met in a row`} value={s.metInARow} />
          <Stat label={`${unit} missed in a row`} value={s.missedInARow} />
        </StatGrid>
        {s.target.period === "week" ? <TargetWeekGrid history={s.history} today={today} /> : <TargetDayGrid history={s.history} today={today} />}
        <TargetLegend />
      </CardContent>
      <CardNote>{describeTarget(s.target.def)}.</CardNote>
    </Card>
  );
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Initiative page: the plan document, checklists (example: the weekly grocery list), recurring tasks, targets,
 * the budget target set by the initiative, and initiatives that are part of this one. Database update 0014.
 */
async function InitiativePlanPanels({ sb, row }: P) {
  if (!(await hasUpdate0014(sb))) {
    return (
      <Card>
        <CardContent className="pt-5">
          <DbUpdateNotice compact file={DB_UPDATE_FILE_0014} features="Plan documents, checklists, and Start an initiative appear after the update." />
        </CardContent>
      </Card>
    );
  }
  const [{ data: docs }, checklists, { data: subs }, { data: templates }, { data: targets }, { data: links }] = await Promise.all([
    sb.from("plan_documents").select("*").eq("initiative_id", row.id).order("created_at"),
    loadChecklists(sb, { initiativeId: row.id }),
    sb.from("initiatives").select("id,name,description").eq("parent_initiative_id", row.id).order("sort_order"),
    sb.from("task_templates").select("*").eq("initiative_id", row.id).order("cadence"),
    sb.from("targets").select("id,name,period,minimum_count,active").eq("initiative_id", row.id),
    sb.from("record_links").select("to_id").eq("from_type", "initiatives").eq("from_id", row.id).eq("to_type", "budget_lines"),
  ]);
  const lineIds = ((links ?? []) as Row[]).map((l) => l.to_id);
  const { data: lines } = lineIds.length ? await sb.from("budget_lines").select("id,category_id,current_monthly,target_monthly").in("id", lineIds) : { data: [] };
  const catIds = ((lines ?? []) as Row[]).map((l) => l.category_id);
  const { data: cats } = catIds.length ? await sb.from("categories").select("id,name").in("id", catIds) : { data: [] };
  const catName = Object.fromEntries(((cats ?? []) as Row[]).map((c) => [c.id, c.name]));
  const tpl = (templates ?? []) as Row[];
  const tg = (targets ?? []) as Row[];
  const bl = (lines ?? []) as Row[];
  return (
    <>
      {((docs ?? []) as Row[]).map((d) => (
        <PlanDocumentCard key={d.id} doc={d} />
      ))}
      {checklists?.lists.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {checklists.lists.map((l) => (
            <ChecklistCard key={l.id} list={l} items={checklists.items.filter((i) => i.checklist_id === l.id)} template={l.task_template_id ? checklists.templates[l.task_template_id] : null} />
          ))}
        </div>
      ) : null}
      {tpl.length || tg.length || bl.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recurring tasks, targets, and budget</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Item</TH>
                  <TH>Kind</TH>
                  <TH>When or amount</TH>
                  <TH>Commitment</TH>
                </TR>
              </THead>
              <TBody>
                {tpl.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <Link href={recordHref("task_templates", t.id)} className="clamp-1 font-medium hover:underline">{t.title}</Link>
                    </TD>
                    <TD className="text-sm">Recurring task</TD>
                    <TD className="text-sm">{t.cadence === "weekly" ? `Every ${WEEKDAY_NAMES[Number(t.weekday ?? 0)]}` : t.cadence === "monthly" ? `Monthly, day ${t.day_of_month ?? 1}` : t.cadence === "daily" ? "Every day" : t.cadence}</TD>
                    <TD className="text-sm">{t.is_commitment ? "Yes (review)" : "No (regular task)"}</TD>
                  </TR>
                ))}
                {tg.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <Link href={recordHref("targets", t.id)} className="clamp-1 font-medium hover:underline">{t.name}</Link>
                    </TD>
                    <TD className="text-sm">Target</TD>
                    <TD className="text-sm">{t.minimum_count} per {t.period}</TD>
                    <TD className="text-sm">Yes</TD>
                  </TR>
                ))}
                {bl.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link href="/finance/budget" className="clamp-1 font-medium hover:underline">{catName[l.category_id] ?? "Budget line"}</Link>
                    </TD>
                    <TD className="text-sm">Budget target</TD>
                    <TD className="tabular text-sm">{money(l.target_monthly)} per month (budget now {money(l.current_monthly)})</TD>
                    <TD className="text-sm">No</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
          <CardNote>Recurring tasks are created each morning on their day. Only reviews, milestones, and targets are commitments.</CardNote>
        </Card>
      ) : null}
      {((subs ?? []) as Row[]).length ? (
        <Card>
          <CardHeader>
            <CardTitle>Part of this initiative</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-slate-100">
              {((subs ?? []) as Row[]).map((s) => (
                <li key={s.id} className="py-2">
                  <Link href={recordHref("initiatives", s.id)} className="text-sm font-medium hover:underline">{s.name}</Link>
                  {s.description ? <span className="clamp-1 text-xs text-muted-foreground">{s.description}</span> : null}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardNote>Initiatives that belong under this one.</CardNote>
        </Card>
      ) : null}
    </>
  );
}

/** Task page: the checklists that go with the task's recurring task (example: the grocery list on "Shop for the week's groceries"). */
async function TaskChecklists({ sb, row }: P) {
  if (!row.template_id) return null;
  const data = await loadChecklists(sb, { templateId: row.template_id });
  if (!data?.lists.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {data.lists.map((l) => (
        <ChecklistCard key={l.id} list={l} items={data.items.filter((i) => i.checklist_id === l.id)} template={l.task_template_id ? data.templates[l.task_template_id] : null} />
      ))}
    </div>
  );
}
