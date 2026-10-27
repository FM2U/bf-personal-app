"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardNote, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm, useUnsavedWork } from "@/components/app/unsaved-changes";
import { AiText } from "@/components/app/ai-text";
import { METRICS } from "@/lib/metrics-list";
import { budgetSavings, type Include, type Proposal } from "@/lib/initiative/proposal";
import { approveDraft, approveDraftAsReduction, discardDraft, saveDraftEdits } from "@/app/actions/initiatives";
import { cn } from "@/lib/utils";

type State = { proposal: Proposal; include: Include };
type Idea = { title: string; steps: string[]; estimated_monthly_savings: number; estimate_basis: string; target_label: string; current_monthly_cost: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "Not set" : `$${Math.round(n).toLocaleString("en-US")}`);
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** One item on the review screen: an Include checkbox in the title row; excluded items are dimmed. */
function ItemCard({ title, kind, included, onInclude, children, note, locked = false, testId }: { title: string; kind: string; included: boolean; onInclude?: (v: boolean) => void; children: React.ReactNode; note?: string; locked?: boolean; testId?: string }) {
  return (
    <Card className={cn("transition-opacity", !included && "opacity-60")} data-testid={testId}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">{kind}</CardDescription>
          <CardTitle className="clamp-2 mt-1">{title || "Untitled"}</CardTitle>
        </div>
        {locked ? (
          <Badge variant="neutral">Always created</Badge>
        ) : (
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm font-medium">
            <input type="checkbox" checked={included} onChange={(e) => onInclude?.(e.target.checked)} className="h-4 w-4 accent-teal-700" aria-label={`Include ${kind.toLowerCase()}: ${title}`} />
            Include
          </label>
        )}
      </CardHeader>
      <CardContent className={cn(!included && "pointer-events-none")}>{children}</CardContent>
      {note ? <CardNote>{note}</CardNote> : null}
    </Card>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title} {count ? <span className="font-normal normal-case text-muted-foreground">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function DraftReview(props: {
  draftId: string;
  initial: State;
  initiatives: string[];
  categories: string[];
  categorySpend: Record<string, number>;
  savingsIdea: Idea | null;
  today: string;
}) {
  const [state, setState] = useState<State>(props.initial);
  const [mode, setMode] = useState<"initiative" | "reduction">("initiative");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialJson = useMemo(() => JSON.stringify(props.initial), [props.initial]);
  const json = JSON.stringify(state);
  const dirty = json !== initialJson && !saved;
  useUnsavedWork(dirty, "The review screen has edits that are not saved. Save edits keeps them; nothing is created until you press Approve selected.");

  const p = state.proposal;
  const inc = state.include;
  const set = (fn: (s: State) => void) => {
    setSaved(false);
    setState((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  };

  const budgetCurrent = p.budget_change ? props.categorySpend[p.budget_change.category.toLowerCase()] ?? null : null;
  const savings = p.budget_change && inc.budget_change
    ? budgetCurrent !== null
      ? budgetSavings(budgetCurrent, p.budget_change.new_monthly_amount)
      : p.budget_change.estimated_monthly_savings ?? p.estimated_monthly_savings ?? null
    : p.estimated_monthly_savings ?? null;

  const selected =
    1 +
    inc.goals.filter(Boolean).length +
    inc.milestones.filter(Boolean).length +
    inc.recurring_tasks.filter(Boolean).length +
    (inc.target ? 1 : 0) +
    (inc.budget_change ? 1 : 0) +
    (inc.decision_condition ? 1 : 0) +
    (inc.plan_document ? 1 : 0) +
    inc.checklists.filter(Boolean).length;
  const total = 1 + p.goals.length + p.milestones.length + p.recurring_tasks.length + (p.target ? 1 : 0) + (p.budget_change ? 1 : 0) + (p.decision_condition ? 1 : 0) + (p.plan_document ? 1 : 0) + p.checklists.length;

  const summary = (
    <div className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card className="relative overflow-hidden border-action-stripe/25 bg-action-bg" id="next-action">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-action-stripe" />
        <CardHeader className="gap-1.5">
          <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">Next required action</CardDescription>
          <CardTitle className="text-lg font-semibold leading-snug">
            {mode === "reduction" ? "Check the reduction action, then approve it." : "Check each item, uncheck what you do not want, then press Approve selected."}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {savings !== null && savings !== undefined ? (
            <div className="rounded-lg border border-status-met/30 bg-white px-3 py-2" data-testid="estimated-savings">
              <p className="text-xs font-medium text-slate-700">Estimated monthly savings</p>
              <p className="tabular text-2xl font-semibold text-status-met">{usd(savings)} per month</p>
              <p className="text-xs text-muted-foreground">
                {p.budget_change && inc.budget_change && budgetCurrent !== null
                  ? `${p.budget_change.category}: ${usd(budgetCurrent)} per month now (last 3 months) minus the new ${usd(p.budget_change.new_monthly_amount)}.`
                  : props.savingsIdea?.estimate_basis ?? "The AI's estimate."}
              </p>
            </div>
          ) : null}
          {mode === "initiative" ? (
            <>
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{selected}</span> of {total} items selected. All are created together, linked to the initiative.
              </p>
              <GuardedForm action={approveDraft} onResult={(r) => setError((r as { error?: string } | null)?.error ?? null)} data-unsaved="off">
                <input type="hidden" name="draft_id" value={props.draftId} />
                <input type="hidden" name="state" value={json} />
                <SubmitButton className="w-full" pendingText="Creating the records..." data-testid="approve-selected">
                  <CheckCircle2 /> Approve selected ({selected})
                </SubmitButton>
              </GuardedForm>
              <GuardedForm action={saveDraftEdits} onResult={(r) => { const e = (r as { error?: string } | null)?.error ?? null; setError(e); if (!e) setSaved(true); }} data-unsaved="off">
                <input type="hidden" name="draft_id" value={props.draftId} />
                <input type="hidden" name="state" value={json} />
                <SubmitButton variant="outline" className="w-full bg-white" pendingText="Saving...">
                  {saved ? "Edits saved" : "Save edits (approve later)"}
                </SubmitButton>
              </GuardedForm>
            </>
          ) : null}
          {error ? <p className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed" role="alert">{error}</p> : null}
        </CardContent>
        <CardNote>Nothing is saved until you approve. The AI proposes; you decide.</CardNote>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <GuardedForm action={discardDraft} data-unsaved="off">
            <input type="hidden" name="draft_id" value={props.draftId} />
            <SubmitButton variant="ghost" size="sm" className="w-full text-muted-foreground" pendingText="Discarding...">
              Discard this draft
            </SubmitButton>
          </GuardedForm>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1 lg:col-span-2">
        {props.savingsIdea ? (
          <Card>
            <CardHeader>
              <CardTitle>Turn this savings idea into</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["initiative", "An initiative", "A goal, a milestone, a plan, a steps checklist, and a budget target when the idea is about a category."],
                ["reduction", "A reduction action on the expense", "One action with a deadline and projected savings, listed in Finance, Budget."],
              ].map(([v, l, d]) => (
                <label key={v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", mode === v ? "border-teal-600 bg-teal-50/60" : "border-border")}>
                  <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v as "initiative" | "reduction")} className="mt-1 accent-teal-700" />
                  <span>
                    <span className="block text-sm font-medium">{l}</span>
                    <span className="clamp-2 text-xs text-muted-foreground">{d}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {mode === "reduction" && props.savingsIdea ? (
          <ReductionForm draftId={props.draftId} idea={props.savingsIdea} today={props.today} onError={setError} />
        ) : (
          <>
            <Section title="The initiative">
              <ItemCard title={p.initiative.name} kind="Name and purpose" included locked testId="review-initiative">
                <FieldGrid cols={2}>
                  <FormField label="Name" required htmlFor="i-name">
                    <Input id="i-name" value={p.initiative.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.initiative.name = e.target.value))} />
                  </FormField>
                  <FormField label="Part of initiative" htmlFor="i-parent">
                    <NativeSelect id="i-parent" value={p.initiative.parent_initiative ?? ""} onChange={(e) => set((s) => void (s.proposal.initiative.parent_initiative = e.target.value || null))}>
                      <option value="">None (a main initiative)</option>
                      {props.initiatives.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Purpose" wide htmlFor="i-purpose">
                    <Textarea id="i-purpose" rows={2} value={p.initiative.purpose} maxLength={500} onChange={(e) => set((s) => void (s.proposal.initiative.purpose = e.target.value))} />
                  </FormField>
                </FieldGrid>
              </ItemCard>
            </Section>

            <Section title="Goals" count={`${inc.goals.filter(Boolean).length} of ${p.goals.length} selected`}>
              {p.goals.map((g, i) => (
                <ItemCard key={i} title={g.title} kind={`Goal ${i + 1}`} included={inc.goals[i]} onInclude={(v) => set((s) => void (s.include.goals[i] = v))} note="A goal is a measured number, a target, and a deadline.">
                  <FieldGrid cols={3}>
                    <FormField label="Goal" wide htmlFor={`g-title-${i}`}>
                      <Input id={`g-title-${i}`} value={g.title} maxLength={160} onChange={(e) => set((s) => void (s.proposal.goals[i].title = e.target.value))} />
                    </FormField>
                    <FormField label="Measured number" htmlFor={`g-metric-${i}`}>
                      <NativeSelect id={`g-metric-${i}`} value={g.metric_key ?? ""} onChange={(e) => set((s) => void (s.proposal.goals[i].metric_key = e.target.value || null))}>
                        <option value="">Not measured automatically</option>
                        {METRICS.filter((m) => !m.key.startsWith("target_") && !m.key.startsWith("pipeline_")).map((m) => (
                          <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                      </NativeSelect>
                    </FormField>
                    <FormField label="Categories (for category spending)" htmlFor={`g-cats-${i}`} help="Separate with commas.">
                      <Input id={`g-cats-${i}`} value={(g.categories ?? []).join(", ")} onChange={(e) => set((s) => void (s.proposal.goals[i].categories = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))} disabled={!g.metric_key?.startsWith("category_")} />
                    </FormField>
                    <FormField label="Goal is met when the number is" htmlFor={`g-cmp-${i}`}>
                      <NativeSelect id={`g-cmp-${i}`} value={g.comparison} onChange={(e) => set((s) => void (s.proposal.goals[i].comparison = e.target.value as "lte" | "gte"))}>
                        <option value="lte">At or below the target</option>
                        <option value="gte">At or above the target</option>
                      </NativeSelect>
                    </FormField>
                    <FormField label="Target" htmlFor={`g-target-${i}`}>
                      <Input id={`g-target-${i}`} type="number" value={g.target_value ?? ""} onChange={(e) => set((s) => void (s.proposal.goals[i].target_value = numOrNull(e.target.value)))} />
                    </FormField>
                    <FormField label="Deadline" required htmlFor={`g-deadline-${i}`}>
                      <Input id={`g-deadline-${i}`} type="date" value={g.deadline} onChange={(e) => set((s) => void (s.proposal.goals[i].deadline = e.target.value))} />
                    </FormField>
                  </FieldGrid>
                </ItemCard>
              ))}
            </Section>

            {p.milestones.length ? (
              <Section title="Milestones" count={`${inc.milestones.filter(Boolean).length} of ${p.milestones.length} selected`}>
                {p.milestones.map((m, i) => (
                  <ItemCard key={i} title={m.title} kind={`Milestone ${i + 1} (a commitment)`} included={inc.milestones[i]} onInclude={(v) => set((s) => void (s.include.milestones[i] = v))} note="If a milestone is missed, a decision opens with the options written here.">
                    <FieldGrid cols={3}>
                      <FormField label="Milestone" htmlFor={`m-title-${i}`}>
                        <Input id={`m-title-${i}`} value={m.title} maxLength={160} onChange={(e) => set((s) => void (s.proposal.milestones[i].title = e.target.value))} />
                      </FormField>
                      <FormField label="Due date" required htmlFor={`m-due-${i}`}>
                        <Input id={`m-due-${i}`} type="date" value={m.due_date} onChange={(e) => set((s) => void (s.proposal.milestones[i].due_date = e.target.value))} />
                      </FormField>
                      <FormField label="Belongs to goal" htmlFor={`m-goal-${i}`}>
                        <NativeSelect id={`m-goal-${i}`} value={m.goal} onChange={(e) => set((s) => void (s.proposal.milestones[i].goal = Number(e.target.value)))}>
                          {p.goals.map((g, j) => (
                            <option key={j} value={j}>Goal {j + 1}: {g.title.slice(0, 50)}</option>
                          ))}
                        </NativeSelect>
                      </FormField>
                      <FormField label="Measurable completion test" wide htmlFor={`m-test-${i}`}>
                        <Input id={`m-test-${i}`} value={m.completion_test} maxLength={300} onChange={(e) => set((s) => void (s.proposal.milestones[i].completion_test = e.target.value))} />
                      </FormField>
                      <FormField label="Options if missed (one per line, written now)" wide htmlFor={`m-opts-${i}`}>
                        <Textarea id={`m-opts-${i}`} rows={3} value={m.options_if_missed.join("\n")} onChange={(e) => set((s) => void (s.proposal.milestones[i].options_if_missed = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4)))} />
                      </FormField>
                    </FieldGrid>
                  </ItemCard>
                ))}
              </Section>
            ) : null}

            {p.recurring_tasks.length ? (
              <Section title="Recurring tasks" count={`${inc.recurring_tasks.filter(Boolean).length} of ${p.recurring_tasks.length} selected`}>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {p.recurring_tasks.map((t, i) => (
                    <ItemCard key={i} title={t.title} kind={t.review && /\breview\b/i.test(t.title) ? "Recurring review (a commitment)" : "Recurring task (regular task)"} included={inc.recurring_tasks[i]} onInclude={(v) => set((s) => void (s.include.recurring_tasks[i] = v))}>
                      <FieldGrid cols={2}>
                        <FormField label="Task" wide htmlFor={`t-title-${i}`}>
                          <Input id={`t-title-${i}`} value={t.title} maxLength={120} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].title = e.target.value))} />
                        </FormField>
                        <FormField label="Repeats" htmlFor={`t-cad-${i}`}>
                          <NativeSelect id={`t-cad-${i}`} value={t.cadence} onChange={(e) => set((s) => {
                            const r = s.proposal.recurring_tasks[i];
                            r.cadence = e.target.value as "daily" | "weekly" | "monthly";
                            if (r.cadence === "weekly" && (r.weekday === null || r.weekday === undefined)) r.weekday = 0;
                            if (r.cadence === "monthly" && !r.day_of_month) r.day_of_month = 1;
                          })}>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </NativeSelect>
                        </FormField>
                        {t.cadence === "monthly" ? (
                          <FormField label="Day of month (1 to 28)" htmlFor={`t-dom-${i}`}>
                            <Input id={`t-dom-${i}`} type="number" min={1} max={28} value={t.day_of_month ?? 1} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].day_of_month = Math.min(28, Math.max(1, Number(e.target.value) || 1))))} />
                          </FormField>
                        ) : (
                          <FormField label="Day of week (weekly only)" htmlFor={`t-wd-${i}`}>
                            <NativeSelect id={`t-wd-${i}`} value={t.weekday ?? 0} disabled={t.cadence !== "weekly"} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].weekday = Number(e.target.value)))}>
                              {WEEKDAYS.map((d, j) => (
                                <option key={d} value={j}>{d}</option>
                              ))}
                            </NativeSelect>
                          </FormField>
                        )}
                        <FormField label="Details" wide htmlFor={`t-det-${i}`}>
                          <Input id={`t-det-${i}`} value={t.details ?? ""} maxLength={500} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].details = e.target.value || null))} />
                        </FormField>
                      </FieldGrid>
                    </ItemCard>
                  ))}
                </div>
              </Section>
            ) : null}

            {p.checklists.length ? (
              <Section title="Checklists" count={`${inc.checklists.filter(Boolean).length} of ${p.checklists.length} selected`}>
                {p.checklists.map((c, i) => (
                  <ChecklistEditor key={i} index={i} c={c} included={inc.checklists[i]} tasks={p.recurring_tasks.map((t) => t.title)} set={set} />
                ))}
              </Section>
            ) : null}

            {p.plan_document ? (
              <Section title="Plan document">
                <ItemCard title={p.plan_document.title} kind="Plan document" included={inc.plan_document} onInclude={(v) => set((s) => void (s.include.plan_document = v))} note="Shown on the initiative page. Bulleted text: a line starting with &quot;- **Lead-in:**&quot; becomes a bullet with a bold lead-in.">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="flex flex-col gap-3">
                      <FormField label="Title" htmlFor="pd-title">
                        <Input id="pd-title" value={p.plan_document.title} maxLength={120} onChange={(e) => set((s) => void (s.proposal.plan_document!.title = e.target.value))} />
                      </FormField>
                      <FormField label="Plan" htmlFor="pd-body">
                        <Textarea id="pd-body" rows={16} value={p.plan_document.body} onChange={(e) => set((s) => void (s.proposal.plan_document!.body = e.target.value))} className="font-mono text-xs" />
                      </FormField>
                    </div>
                    <div className="min-w-0 rounded-lg border border-border bg-slate-50 p-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Preview</p>
                      <AiText text={p.plan_document.body} />
                    </div>
                  </div>
                </ItemCard>
              </Section>
            ) : null}

            {p.budget_change || p.target || p.decision_condition ? (
              <Section title="Budget, target, and decision condition">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {p.budget_change ? (
                    <ItemCard title={`${p.budget_change.category}: ${usd(p.budget_change.new_monthly_amount)} per month`} kind="Budget target change" included={inc.budget_change} onInclude={(v) => set((s) => void (s.include.budget_change = v))} testId="review-budget" note="Sets the target for this category in Finance, Budget.">
                      <FieldGrid cols={2}>
                        <FormField label="Category" htmlFor="b-cat">
                          <NativeSelect id="b-cat" value={p.budget_change.category} onChange={(e) => set((s) => void (s.proposal.budget_change!.category = e.target.value))}>
                            {[...new Set([p.budget_change.category, ...props.categories])].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </NativeSelect>
                        </FormField>
                        <FormField label="New monthly amount" htmlFor="b-amt" help={budgetCurrent !== null ? `Spending now: ${usd(budgetCurrent)} per month (last 3 full months).` : "No spending in this category in the last 3 full months."}>
                          <Input id="b-amt" type="number" min={0} value={p.budget_change.new_monthly_amount} onChange={(e) => set((s) => void (s.proposal.budget_change!.new_monthly_amount = Math.max(0, Number(e.target.value) || 0)))} />
                        </FormField>
                      </FieldGrid>
                    </ItemCard>
                  ) : null}
                  {p.target ? (
                    <ItemCard title={p.target.name} kind="Target (a commitment)" included={inc.target} onInclude={(v) => set((s) => void (s.include.target = v))} note="Counted with the +1 button on Productivity, Today.">
                      <FieldGrid cols={2}>
                        <FormField label="Name" wide htmlFor="tg-name">
                          <Input id="tg-name" value={p.target.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.target!.name = e.target.value))} />
                        </FormField>
                        <FormField label="Period" htmlFor="tg-period">
                          <NativeSelect id="tg-period" value={p.target.period} onChange={(e) => set((s) => void (s.proposal.target!.period = e.target.value as "day" | "week"))}>
                            <option value="day">Per day</option>
                            <option value="week">Per week (Monday to Sunday)</option>
                          </NativeSelect>
                        </FormField>
                        <FormField label="Minimum count per period" htmlFor="tg-min">
                          <Input id="tg-min" type="number" min={1} value={p.target.minimum_count} onChange={(e) => set((s) => void (s.proposal.target!.minimum_count = Math.max(1, Math.round(Number(e.target.value) || 1))))} />
                        </FormField>
                      </FieldGrid>
                    </ItemCard>
                  ) : null}
                  {p.decision_condition ? (
                    <ItemCard title={p.decision_condition.name} kind="Decision condition" included={inc.decision_condition} onInclude={(v) => set((s) => void (s.include.decision_condition = v))} note="Checked every day and after every change.">
                      <FieldGrid cols={2}>
                        <FormField label="Name" wide htmlFor="dc-name">
                          <Input id="dc-name" value={p.decision_condition.name} maxLength={120} onChange={(e) => set((s) => void (s.proposal.decision_condition!.name = e.target.value))} />
                        </FormField>
                        <FormField label="Threshold" htmlFor="dc-th">
                          <Input id="dc-th" type="number" value={p.decision_condition.threshold} onChange={(e) => set((s) => void (s.proposal.decision_condition!.threshold = Number(e.target.value) || 0))} />
                        </FormField>
                        <FormField label="Task created when met" htmlFor="dc-task">
                          <Input id="dc-task" value={p.decision_condition.action_task} maxLength={160} onChange={(e) => set((s) => void (s.proposal.decision_condition!.action_task = e.target.value))} />
                        </FormField>
                      </FieldGrid>
                    </ItemCard>
                  ) : null}
                </div>
              </Section>
            ) : null}
          </>
        )}
      </div>
      <div className="order-1 min-w-0 lg:order-2">{summary}</div>
    </div>
  );
}

function ChecklistEditor({ index: i, c, included, tasks, set }: { index: number; c: Proposal["checklists"][number]; included: boolean; tasks: string[]; set: (fn: (s: State) => void) => void }) {
  return (
    <ItemCard title={`${c.name} (${c.items.length} items)`} kind="Checklist" included={included} onInclude={(v) => set((s) => void (s.include.checklists[i] = v))} testId={`review-checklist-${i}`} note={c.reset_weekly ? "Every item is unchecked each week when its recurring task is created." : "Items stay checked until you uncheck them."}>
      <FieldGrid cols={3}>
        <FormField label="Name" htmlFor={`c-name-${i}`}>
          <Input id={`c-name-${i}`} value={c.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.checklists[i].name = e.target.value))} />
        </FormField>
        <FormField label="Goes with the recurring task" htmlFor={`c-task-${i}`}>
          <NativeSelect id={`c-task-${i}`} value={c.recurring_task ?? ""} onChange={(e) => set((s) => void (s.proposal.checklists[i].recurring_task = e.target.value === "" ? null : Number(e.target.value)))}>
            <option value="">None</option>
            {tasks.map((t, j) => (
              <option key={j} value={j}>{t}</option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Reset each week" htmlFor={`c-reset-${i}`}>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input id={`c-reset-${i}`} type="checkbox" checked={c.reset_weekly} onChange={(e) => set((s) => void (s.proposal.checklists[i].reset_weekly = e.target.checked))} className="h-4 w-4 accent-teal-700" />
            Uncheck every item weekly
          </label>
        </FormField>
      </FieldGrid>
      <div className="mt-1 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] gap-2 border-b border-border bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,12rem)_2.25rem]">
          <span>Item</span>
          <span>Quantity</span>
          <span className="hidden sm:block">Notes</span>
          <span className="sr-only">Remove</span>
        </div>
        <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
          {c.items.map((it, j) => (
            <li key={j} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] items-center gap-2 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,12rem)_2.25rem]">
              <Input aria-label={`Item ${j + 1}`} value={it.text} maxLength={160} className="h-8" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].text = e.target.value))} />
              <Input aria-label={`Quantity ${j + 1}`} value={it.quantity ?? ""} maxLength={40} className="h-8" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].quantity = e.target.value || null))} />
              <Input aria-label={`Notes ${j + 1}`} value={it.notes ?? ""} maxLength={200} className="hidden h-8 sm:flex" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].notes = e.target.value || null))} />
              <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-slate-100" aria-label={`Remove ${it.text}`} onClick={() => set((s) => void s.proposal.checklists[i].items.splice(j, 1))} disabled={c.items.length <= 1}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => set((s) => void s.proposal.checklists[i].items.push({ text: "New item", quantity: null, notes: null }))} disabled={c.items.length >= 80}>
        <Plus /> Add item
      </Button>
    </ItemCard>
  );
}

function ReductionForm({ draftId, idea, today, onError }: { draftId: string; idea: Idea; today: string; onError: (e: string | null) => void }) {
  const deadline = new Date(`${today}T12:00:00`);
  deadline.setDate(deadline.getDate() + 30);
  return (
    <Card data-testid="review-reduction">
      <CardHeader>
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">Reduction action</CardDescription>
        <CardTitle>{idea.target_label}</CardTitle>
      </CardHeader>
      <CardContent>
        <GuardedForm action={approveDraftAsReduction} onResult={(r) => onError((r as { error?: string } | null)?.error ?? null)} className="flex flex-col gap-2">
          <input type="hidden" name="draft_id" value={draftId} />
          <FieldGrid cols={3}>
            <FormField label="Action" wide htmlFor="r-title">
              <Input id="r-title" name="title" defaultValue={idea.title} maxLength={200} required />
            </FormField>
            <FormField label="Deadline" htmlFor="r-deadline">
              <Input id="r-deadline" name="deadline" type="date" defaultValue={deadline.toISOString().slice(0, 10)} required />
            </FormField>
            <FormField label="Projected monthly savings" htmlFor="r-savings" help={idea.estimate_basis}>
              <Input id="r-savings" name="projected_monthly_savings" type="number" min={0} step="0.01" defaultValue={idea.estimated_monthly_savings} required />
            </FormField>
            <FormField label="Current monthly cost" htmlFor="r-cost">
              <Input id="r-cost" value={usd(idea.current_monthly_cost)} readOnly disabled />
            </FormField>
            <FormField label="Steps (one per line)" wide htmlFor="r-steps">
              <Textarea id="r-steps" name="steps" rows={4} defaultValue={idea.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")} />
            </FormField>
          </FieldGrid>
          <SubmitButton className="self-start" pendingText="Saving..." data-testid="approve-reduction">
            <CheckCircle2 /> Approve as a reduction action
          </SubmitButton>
        </GuardedForm>
      </CardContent>
      <CardNote>Track projected and actual savings on the reduction action page.</CardNote>
    </Card>
  );
}
