"use client";

/**
 * Editing an initiative draft: one editor per part (name and purpose, goals, milestones, recurring tasks, target and
 * budget, plan and checklists). The step-by-step setup in the window shows one part per step
 * (src/components/app/windows/setup-window.tsx); the review page (Open full page) shows them all with the
 * Next required action card. Every item has an Include checkbox; "+ Add" adds a blank item (Add manually starts empty).
 */
import { useMemo, useState } from "react";
import { CheckCircle2, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardNote, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm, useUnsavedWork } from "@/components/app/unsaved-changes";
import { AiText } from "@/components/app/ai-text";
import { METRICS } from "@/lib/metrics-list";
import { budgetSavings, isReviewCommitment, type Proposal } from "@/lib/initiative/proposal";
import { itemIssue, itemsNeedingAttention, newBudgetChange, newChecklist, newGoal, newMilestone, newPlan, newRecurringTask, newTarget, selectedCount, type DraftState } from "@/lib/initiative/draft";
import { budgetFacts, checklistFacts, conditionFacts, goalFacts, milestoneFacts, planFacts, targetFacts, taskFacts } from "@/lib/initiative/items";
import { RepeatItem, RepeatList } from "@/components/app/repeat-items";
import { approveDraft, approveDraftAsReduction, discardDraft, saveDraftEdits } from "@/app/actions/initiatives";
import { cn } from "@/lib/utils";
import { summaryFromProposal } from "@/lib/initiative/summary";
import { useAppWindow } from "@/components/app/window-host";

type State = DraftState;
export type Idea = { title: string; steps: string[]; estimated_monthly_savings: number; estimate_basis: string; target_label: string; current_monthly_cost: number };
export type Setter = (fn: (s: State) => void) => void;
/** `draftId` names where each list's open and closed items are remembered in this browser. */
export type EditorProps = { state: State; set: Setter; initiatives: string[]; categories: string[]; categorySpend: Record<string, number>; today: string; draftId?: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "Not set" : `$${Math.round(n).toLocaleString("en-US")}`);
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** The draft's estimated monthly savings and the budget category's spending now. */
export function draftSavings(state: State, categorySpend: Record<string, number>, ideaBasis?: string) {
  const p = state.proposal;
  const inc = state.include;
  const budgetCurrent = p.budget_change ? categorySpend[p.budget_change.category.toLowerCase()] ?? null : null;
  const savings =
    p.budget_change && inc.budget_change
      ? budgetCurrent !== null
        ? budgetSavings(budgetCurrent, p.budget_change.new_monthly_amount)
        : p.budget_change.estimated_monthly_savings ?? p.estimated_monthly_savings ?? null
      : p.estimated_monthly_savings ?? null;
  const basis =
    p.budget_change && inc.budget_change && budgetCurrent !== null
      ? `${p.budget_change.category}: ${usd(budgetCurrent)} per month now (last 3 months) minus the new ${usd(p.budget_change.new_monthly_amount)}.`
      : ideaBasis ?? "The AI's estimate.";
  return { savings, basis, budgetCurrent };
}

/** One item: an Include checkbox in the title row; excluded items are dimmed. */
function ItemCard({ title, kind, included, onInclude, children, note, locked = false, testId, onRemove }: { title: string; kind: string; included: boolean; onInclude?: (v: boolean) => void; children: React.ReactNode; note?: string; locked?: boolean; testId?: string; onRemove?: () => void }) {
  return (
    <Card className={cn("transition-opacity", !included && "opacity-60")} data-testid={testId}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">{kind}</CardDescription>
          <CardTitle className="clamp-2 mt-1">{title || "Untitled"}</CardTitle>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {locked ? (
            <Badge variant="neutral">Always created</Badge>
          ) : (
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm font-medium">
              <input type="checkbox" checked={included} onChange={(e) => onInclude?.(e.target.checked)} className="h-4 w-4 accent-primary" aria-label={`Include ${kind.toLowerCase()}: ${title}`} />
              Include
            </label>
          )}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 hover:text-slate-900" aria-label={`Remove ${kind.toLowerCase()}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={cn(!included && "pointer-events-none")}>{children}</CardContent>
      {note ? <CardNote>{note}</CardNote> : null}
    </Card>
  );
}

function Section({ title, count, children, hideTitle = false }: { title: string; count?: string; children: React.ReactNode; hideTitle?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      {hideTitle ? null : (
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
          {title} {count ? <span className="font-normal normal-case text-muted-foreground">{count}</span> : null}
        </h2>
      )}
      {children}
    </section>
  );
}

function AddButton({ children, onClick, disabled, testId }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; testId?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className="self-start" onClick={onClick} disabled={disabled} data-testid={testId}>
      <Plus /> {children}
    </Button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

const countText = (inc: boolean[], n: number) => `${inc.filter(Boolean).length} of ${n} selected`;

// ---------- Editors (one per setup step) ----------

export function NameEditor({ state, set, initiatives }: EditorProps) {
  const p = state.proposal;
  return (
    <ItemCard title={p.initiative.name} kind="Name and purpose" included locked testId="review-initiative">
      <FieldGrid cols={2}>
        <FormField label="Name" required htmlFor="i-name">
          <Input id="i-name" value={p.initiative.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.initiative.name = e.target.value))} placeholder="Example: Weekly meal plan" />
        </FormField>
        <FormField label="Part of initiative" htmlFor="i-parent">
          <NativeSelect id="i-parent" value={p.initiative.parent_initiative ?? ""} onChange={(e) => set((s) => void (s.proposal.initiative.parent_initiative = e.target.value || null))}>
            <option value="">None (a main initiative)</option>
            {initiatives.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Purpose" wide htmlFor="i-purpose">
          <Textarea id="i-purpose" rows={2} value={p.initiative.purpose} maxLength={500} onChange={(e) => set((s) => void (s.proposal.initiative.purpose = e.target.value))} placeholder="Why you are doing it, in one or two sentences." />
        </FormField>
      </FieldGrid>
    </ItemCard>
  );
}

/** Storage key for the open state of one list in one draft (null when there is no draft id). */
const listKey = (draftId: string | undefined, list: string) => (draftId ? `items:${draftId}:${list}` : null);

/** The fields of an open item: 12 columns on a wide item, one column on a narrow one (each field sets its span). */
function ItemGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-12 gap-x-4">{children}</div>;
}

// Column spans by item width (the item is a size container): one column below 448px (phone), short fields in pairs
// up to 576px, a medium layout up to 1024px (the review page column), then the wide rows (the setup window). Written out in full so Tailwind generates each class.
const SPAN = {
  // Milestones: Milestone 5, Due date 2, Belongs to goal 5 (6, 3, 3 on a medium item); test 7 and options 5.
  mName: "col-span-12 @xl/item:col-span-6 @5xl/item:col-span-5",
  mDue: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-2",
  mGoal: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-5",
  mTest: "col-span-12 @xl/item:col-span-7",
  mOpts: "col-span-12 @xl/item:col-span-5",
  // Goals: Goal 4, Measured number 4, Target 2, Deadline 2; then Met when 3 and Categories 4.
  gTitle: "col-span-12 @xl/item:col-span-6 @5xl/item:col-span-4",
  gMetric: "col-span-12 @xl/item:col-span-6 @5xl/item:col-span-4",
  gShort: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-2",
  gCmp: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3",
  gCats: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-4",
  // Recurring tasks: Task 4, Repeats 2, Day 2, Details 4 (Task 6, Repeats 3, Day 3, Details below on a medium item).
  tTitle: "col-span-12 @xl/item:col-span-6 @5xl/item:col-span-4",
  tCad: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-2",
  tDay: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3 @5xl/item:col-span-2",
  tDet: "col-span-12 @5xl/item:col-span-4",
  // Checklists: Name 4, Goes with 5, Reset 3. Target and budget rows: 5, 4, 3 (or 4, 3, 5).
  five: "col-span-12 @xl/item:col-span-5",
  four: "col-span-12 @xl/item:col-span-4",
  three: "col-span-12 @md/item:col-span-6 @xl/item:col-span-3",
};

export function GoalsEditor({ state, set, today, hideTitle, draftId }: EditorProps & { hideTitle?: boolean }) {
  const p = state.proposal;
  const inc = state.include;
  return (
    <RepeatList title="Goals" count={p.goals.length} countText={p.goals.length ? countText(inc.goals, p.goals.length) : undefined} attention={itemsNeedingAttention(state, "goals")} storageKey={listKey(draftId, "goals")} hideTitle={hideTitle} testId="list-goals">
      {!p.goals.length ? <Empty>No goals yet. Add one, or press Save to skip this step.</Empty> : null}
      {p.goals.map((g, i) => (
        <RepeatItem key={i} index={i} kind="Goal" name={g.title} facts={goalFacts(g)} included={inc.goals[i]} onInclude={(v) => set((s) => void (s.include.goals[i] = v))} onRemove={() => set((s) => removeGoal(s, i))}>
          <ItemGrid>
            <FormField label="Goal" required htmlFor={`g-title-${i}`} span={SPAN.gTitle}>
              <Input id={`g-title-${i}`} value={g.title} maxLength={160} onChange={(e) => set((s) => void (s.proposal.goals[i].title = e.target.value))} placeholder="Example: Food spending under $700 per month by March 1" />
            </FormField>
            <FormField label="Measured number" htmlFor={`g-metric-${i}`} span={SPAN.gMetric}>
              <NativeSelect id={`g-metric-${i}`} value={g.metric_key ?? ""} onChange={(e) => set((s) => void (s.proposal.goals[i].metric_key = e.target.value || null))}>
                <option value="">Not measured automatically</option>
                {METRICS.filter((m) => !m.key.startsWith("target_") && !m.key.startsWith("pipeline_")).map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Target" htmlFor={`g-target-${i}`} span={SPAN.gShort}>
              <Input id={`g-target-${i}`} type="number" value={g.target_value ?? ""} onChange={(e) => set((s) => void (s.proposal.goals[i].target_value = numOrNull(e.target.value)))} />
            </FormField>
            <FormField label="Deadline" required htmlFor={`g-deadline-${i}`} span={SPAN.gShort}>
              <Input id={`g-deadline-${i}`} type="date" value={g.deadline} onChange={(e) => set((s) => void (s.proposal.goals[i].deadline = e.target.value))} />
            </FormField>
            <FormField label="Goal is met when the number is" htmlFor={`g-cmp-${i}`} span={SPAN.gCmp}>
              <NativeSelect id={`g-cmp-${i}`} value={g.comparison} onChange={(e) => set((s) => void (s.proposal.goals[i].comparison = e.target.value as "lte" | "gte"))}>
                <option value="lte">At or below the target</option>
                <option value="gte">At or above the target</option>
              </NativeSelect>
            </FormField>
            <FormField label="Categories (for category spending)" htmlFor={`g-cats-${i}`} span={SPAN.gCats} help={g.metric_key?.startsWith("category_") ? "Separate with commas." : "Only for a category spending number."}>
              <Input id={`g-cats-${i}`} value={(g.categories ?? []).join(", ")} onChange={(e) => set((s) => void (s.proposal.goals[i].categories = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))} disabled={!g.metric_key?.startsWith("category_")} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ))}
      {p.goals.length < 3 ? (
        <AddButton onClick={() => set((s) => { s.proposal.goals.push(newGoal(today)); s.include.goals.push(true); })} testId="add-goal">
          Add goal
        </AddButton>
      ) : null}
    </RepeatList>
  );
}

/** Removing a goal: milestones that pointed at a later goal move up one; a milestone of the removed goal goes to the first goal. */
function removeGoal(s: State, i: number) {
  s.proposal.goals.splice(i, 1);
  s.include.goals.splice(i, 1);
  for (const m of s.proposal.milestones) m.goal = m.goal > i ? m.goal - 1 : m.goal === i ? 0 : m.goal;
}

export function MilestonesEditor({ state, set, today, hideTitle, draftId }: EditorProps & { hideTitle?: boolean }) {
  const p = state.proposal;
  const inc = state.include;
  return (
    <RepeatList title="Milestones" count={p.milestones.length} countText={p.milestones.length ? countText(inc.milestones, p.milestones.length) : undefined} attention={itemsNeedingAttention(state, "milestones")} storageKey={listKey(draftId, "milestones")} hideTitle={hideTitle} testId="list-milestones">
      {!p.milestones.length ? <Empty>No milestones yet. Add one, or press Save to skip this step.</Empty> : null}
      {p.milestones.map((m, i) => (
        <RepeatItem key={i} index={i} kind="Milestone" name={m.title} facts={milestoneFacts(m, p.goals.length)} included={inc.milestones[i]} onInclude={(v) => set((s) => void (s.include.milestones[i] = v))} onRemove={() => set((s) => { s.proposal.milestones.splice(i, 1); s.include.milestones.splice(i, 1); })}>
          <ItemGrid>
            <FormField label="Milestone" required htmlFor={`m-title-${i}`} span={SPAN.mName}>
              <Input id={`m-title-${i}`} value={m.title} maxLength={160} onChange={(e) => set((s) => void (s.proposal.milestones[i].title = e.target.value))} placeholder="Example: Menu and recipes chosen" />
            </FormField>
            <FormField label="Due date" required htmlFor={`m-due-${i}`} span={SPAN.mDue}>
              <Input id={`m-due-${i}`} type="date" value={m.due_date} onChange={(e) => set((s) => void (s.proposal.milestones[i].due_date = e.target.value))} />
            </FormField>
            <FormField label="Belongs to goal" htmlFor={`m-goal-${i}`} span={SPAN.mGoal}>
              <NativeSelect id={`m-goal-${i}`} value={m.goal} onChange={(e) => set((s) => void (s.proposal.milestones[i].goal = Number(e.target.value)))} disabled={!p.goals.length}>
                {p.goals.length ? (
                  p.goals.map((g, j) => (
                    <option key={j} value={j}>
                      Goal {j + 1}: {(g.title || "Untitled").slice(0, 50)}
                    </option>
                  ))
                ) : (
                  <option value={0}>Add a goal first</option>
                )}
              </NativeSelect>
            </FormField>
            <FormField label="Measurable completion test" required htmlFor={`m-test-${i}`} span={SPAN.mTest} hint="What you can check on the due date.">
              <Textarea id={`m-test-${i}`} rows={3} value={m.completion_test} maxLength={300} onChange={(e) => set((s) => void (s.proposal.milestones[i].completion_test = e.target.value.replace(/\n/g, " ")))} placeholder="Example: 3 LOIs submitted" />
            </FormField>
            <FormField label="Options if missed (one per line, written now)" required htmlFor={`m-opts-${i}`} span={SPAN.mOpts} hint="If it is missed, a decision opens with these options.">
              <Textarea id={`m-opts-${i}`} rows={3} value={m.options_if_missed.join("\n")} onChange={(e) => set((s) => void (s.proposal.milestones[i].options_if_missed = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4)))} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ))}
      {p.milestones.length < 4 ? (
        <AddButton onClick={() => set((s) => { s.proposal.milestones.push(newMilestone(today)); s.include.milestones.push(true); })} testId="add-milestone">
          Add milestone
        </AddButton>
      ) : null}
    </RepeatList>
  );
}

export function TasksEditor({ state, set, hideTitle, draftId }: EditorProps & { hideTitle?: boolean }) {
  const p = state.proposal;
  const inc = state.include;
  return (
    <RepeatList title="Recurring tasks" count={p.recurring_tasks.length} countText={p.recurring_tasks.length ? countText(inc.recurring_tasks, p.recurring_tasks.length) : undefined} attention={itemsNeedingAttention(state, "recurring_tasks")} storageKey={listKey(draftId, "tasks")} hideTitle={hideTitle} testId="list-tasks">
      {!p.recurring_tasks.length ? <Empty>No recurring tasks yet. Add one, or press Save to skip this step.</Empty> : null}
      {p.recurring_tasks.map((t, i) => (
        <RepeatItem
          key={i}
          index={i}
          kind="Recurring task"
          name={t.title}
          facts={taskFacts(t, isReviewCommitment(t))}
          included={inc.recurring_tasks[i]}
          onInclude={(v) => set((s) => void (s.include.recurring_tasks[i] = v))}
          onRemove={() =>
            set((s) => {
              s.proposal.recurring_tasks.splice(i, 1);
              s.include.recurring_tasks.splice(i, 1);
              for (const c of s.proposal.checklists) c.recurring_task = c.recurring_task === i ? null : c.recurring_task !== null && c.recurring_task !== undefined && c.recurring_task > i ? c.recurring_task - 1 : c.recurring_task;
            })
          }
        >
          <ItemGrid>
            <FormField label="Task" required htmlFor={`t-title-${i}`} span={SPAN.tTitle}>
              <Input id={`t-title-${i}`} value={t.title} maxLength={120} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].title = e.target.value))} />
            </FormField>
            <FormField label="Repeats" htmlFor={`t-cad-${i}`} span={SPAN.tCad}>
              <NativeSelect
                id={`t-cad-${i}`}
                value={t.cadence}
                onChange={(e) =>
                  set((s) => {
                    const r = s.proposal.recurring_tasks[i];
                    r.cadence = e.target.value as "daily" | "weekly" | "monthly";
                    if (r.cadence === "weekly" && (r.weekday === null || r.weekday === undefined)) r.weekday = 0;
                    if (r.cadence === "monthly" && !r.day_of_month) r.day_of_month = 1;
                  })
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </NativeSelect>
            </FormField>
            {t.cadence === "monthly" ? (
              <FormField label="Day of month (1 to 28)" htmlFor={`t-dom-${i}`} span={SPAN.tDay}>
                <Input id={`t-dom-${i}`} type="number" min={1} max={28} value={t.day_of_month ?? 1} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].day_of_month = Math.min(28, Math.max(1, Number(e.target.value) || 1))))} />
              </FormField>
            ) : (
              <FormField label="Day of week (weekly only)" htmlFor={`t-wd-${i}`} span={SPAN.tDay}>
                <NativeSelect id={`t-wd-${i}`} value={t.weekday ?? 0} disabled={t.cadence !== "weekly"} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].weekday = Number(e.target.value)))}>
                  {WEEKDAYS.map((d, j) => (
                    <option key={d} value={j}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            )}
            <FormField label="Details" htmlFor={`t-det-${i}`} span={SPAN.tDet}>
              <Input id={`t-det-${i}`} value={t.details ?? ""} maxLength={500} onChange={(e) => set((s) => void (s.proposal.recurring_tasks[i].details = e.target.value || null))} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ))}
      {p.recurring_tasks.length < 6 ? (
        <AddButton onClick={() => set((s) => { s.proposal.recurring_tasks.push(newRecurringTask()); s.include.recurring_tasks.push(true); })} testId="add-recurring-task">
          Add recurring task
        </AddButton>
      ) : null}
    </RepeatList>
  );
}

export function TargetBudgetEditor({ state, set, categories, categorySpend, hideTitle, draftId }: EditorProps & { hideTitle?: boolean }) {
  const p = state.proposal;
  const inc = state.include;
  const budgetCurrent = p.budget_change ? categorySpend[p.budget_change.category.toLowerCase()] ?? null : null;
  // One list in this order: budget change, target, decision condition (each only when there is one).
  const kinds = [p.budget_change ? "budget" : null, p.target ? "target" : null, p.decision_condition ? "condition" : null].filter(Boolean) as string[];
  const at = (k: string) => kinds.indexOf(k);
  const attention = kinds.map((k) => (k === "budget" ? inc.budget_change && !!itemIssue(state, "budget_change") : k === "target" ? inc.target && !!itemIssue(state, "target") : false));
  return (
    <RepeatList title="Budget, target, and decision condition" count={kinds.length} attention={attention} storageKey={listKey(draftId, "target")} hideTitle={hideTitle} testId="list-target">
      {!kinds.length ? <Empty>No target or budget change yet. Add one, or press Save to skip this step.</Empty> : null}
      {p.budget_change ? (
        <RepeatItem
          index={at("budget")}
          kind="Budget change"
          name={`Budget: ${p.budget_change.category || "Category"}`}
          facts={budgetFacts(p.budget_change, budgetCurrent)}
          included={inc.budget_change}
          onInclude={(v) => set((s) => void (s.include.budget_change = v))}
          onRemove={() => set((s) => { s.proposal.budget_change = null; s.include.budget_change = false; })}
          testId="review-budget"
        >
          <ItemGrid>
            <FormField label="Category" required htmlFor="b-cat" span={SPAN.five} hint="Sets this category's target in Finance, Budget.">
              <NativeSelect id="b-cat" value={p.budget_change.category} onChange={(e) => set((s) => void (s.proposal.budget_change!.category = e.target.value))}>
                {[...new Set([p.budget_change.category, ...categories])].filter(Boolean).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="New monthly amount" htmlFor="b-amt" span={SPAN.four} hint={budgetCurrent !== null ? `Spending now: ${usd(budgetCurrent)} per month (last 3 full months).` : "No spending in this category in the last 3 full months."}>
              <Input id="b-amt" type="number" min={0} value={p.budget_change.new_monthly_amount} onChange={(e) => set((s) => void (s.proposal.budget_change!.new_monthly_amount = Math.max(0, Number(e.target.value) || 0)))} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ) : null}
      {p.target ? (
        <RepeatItem
          index={at("target")}
          kind="Target"
          name={p.target.name}
          facts={targetFacts(p.target)}
          included={inc.target}
          onInclude={(v) => set((s) => void (s.include.target = v))}
          onRemove={() => set((s) => { s.proposal.target = null; s.include.target = false; })}
          testId="review-target"
        >
          <ItemGrid>
            <FormField label="Name" required htmlFor="tg-name" span={SPAN.five} hint="A commitment, counted with +1 on Productivity, Today.">
              <Input id="tg-name" value={p.target.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.target!.name = e.target.value))} placeholder="Example: Cook at home" />
            </FormField>
            <FormField label="Period" htmlFor="tg-period" span={SPAN.four}>
              <NativeSelect id="tg-period" value={p.target.period} onChange={(e) => set((s) => void (s.proposal.target!.period = e.target.value as "day" | "week"))}>
                <option value="day">Per day</option>
                <option value="week">Per week (Monday to Sunday)</option>
              </NativeSelect>
            </FormField>
            <FormField label="Minimum count per period" htmlFor="tg-min" span={SPAN.three}>
              <Input id="tg-min" type="number" min={1} value={p.target.minimum_count} onChange={(e) => set((s) => void (s.proposal.target!.minimum_count = Math.max(1, Math.round(Number(e.target.value) || 1))))} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ) : null}
      {p.decision_condition ? (
        <RepeatItem index={at("condition")} kind="Decision condition" name={p.decision_condition.name} facts={conditionFacts(p.decision_condition)} included={inc.decision_condition} onInclude={(v) => set((s) => void (s.include.decision_condition = v))} testId="review-condition">
          <ItemGrid>
            <FormField label="Name" htmlFor="dc-name" span={SPAN.four} hint="Checked every day and after every change.">
              <Input id="dc-name" value={p.decision_condition.name} maxLength={120} onChange={(e) => set((s) => void (s.proposal.decision_condition!.name = e.target.value))} />
            </FormField>
            <FormField label="Threshold" htmlFor="dc-th" span={SPAN.three}>
              <Input id="dc-th" type="number" value={p.decision_condition.threshold} onChange={(e) => set((s) => void (s.proposal.decision_condition!.threshold = Number(e.target.value) || 0))} />
            </FormField>
            <FormField label="Task created when met" htmlFor="dc-task" span={SPAN.five}>
              <Input id="dc-task" value={p.decision_condition.action_task} maxLength={160} onChange={(e) => set((s) => void (s.proposal.decision_condition!.action_task = e.target.value))} />
            </FormField>
          </ItemGrid>
        </RepeatItem>
      ) : null}
      {!p.target || !p.budget_change ? (
        <div className="flex flex-wrap gap-2">
          {!p.target ? (
            <AddButton onClick={() => set((s) => { s.proposal.target = newTarget(); s.include.target = true; })} testId="add-target">
              Add target
            </AddButton>
          ) : null}
          {!p.budget_change ? (
            <AddButton onClick={() => set((s) => { s.proposal.budget_change = newBudgetChange(categories[0] ?? ""); s.include.budget_change = true; })} disabled={!categories.length} testId="add-budget">
              Add budget change
            </AddButton>
          ) : null}
        </div>
      ) : null}
    </RepeatList>
  );
}

export function PlanChecklistsEditor({ state, set, hideTitle, draftId }: EditorProps & { hideTitle?: boolean }) {
  const p = state.proposal;
  const inc = state.include;
  const tasks = p.recurring_tasks.map((t) => t.title);
  return (
    <div className="flex flex-col gap-6">
      <RepeatList title="Plan document" count={p.plan_document ? 1 : 0} attention={[!!p.plan_document && inc.plan_document && !!itemIssue(state, "plan_document")]} storageKey={listKey(draftId, "plan")} hideTitle={hideTitle} testId="list-plan">
        {p.plan_document ? (
          <RepeatItem
            index={0}
            kind="Plan"
            name={p.plan_document.title}
            facts={planFacts(p.plan_document)}
            included={inc.plan_document}
            onInclude={(v) => set((s) => void (s.include.plan_document = v))}
            onRemove={() => set((s) => { s.proposal.plan_document = null; s.include.plan_document = false; })}
            testId="review-plan"
          >
            <div className="grid grid-cols-1 gap-4 pb-4 @3xl/item:grid-cols-2">
              <div className="flex flex-col">
                <FormField label="Title" required htmlFor="pd-title">
                  <Input id="pd-title" value={p.plan_document.title} maxLength={120} onChange={(e) => set((s) => void (s.proposal.plan_document!.title = e.target.value))} />
                </FormField>
                <FormField label="Plan" required htmlFor="pd-body" hint='Start a line with "- **Lead-in:**" for a bold bullet.'>
                  <Textarea id="pd-body" rows={14} value={p.plan_document.body} onChange={(e) => set((s) => void (s.proposal.plan_document!.body = e.target.value))} className="font-mono text-xs" placeholder={"- **First step:** what you will do\n- **Second step:** ..."} />
                </FormField>
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-slate-50 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">Preview</p>
                {p.plan_document.body.trim() ? <AiText text={p.plan_document.body} /> : <p className="text-sm text-muted-foreground">The plan appears here as you type.</p>}
              </div>
            </div>
          </RepeatItem>
        ) : (
          <div className="flex flex-col gap-2">
            <Empty>No plan document. Add one, or press Save to skip.</Empty>
            <AddButton onClick={() => set((s) => { s.proposal.plan_document = newPlan(s.proposal.initiative.name); s.include.plan_document = true; })} testId="add-plan">
              Add plan
            </AddButton>
          </div>
        )}
      </RepeatList>
      <RepeatList title="Checklists" count={p.checklists.length} countText={p.checklists.length ? countText(inc.checklists, p.checklists.length) : undefined} attention={itemsNeedingAttention(state, "checklists")} storageKey={listKey(draftId, "checklists")} testId="list-checklists">
        {p.checklists.map((c, i) => (
          <ChecklistEditor key={i} index={i} c={c} included={inc.checklists[i]} tasks={tasks} set={set} />
        ))}
        {p.checklists.length < 4 ? (
          <AddButton onClick={() => set((s) => { s.proposal.checklists.push(newChecklist()); s.include.checklists.push(true); })} testId="add-checklist">
            Add checklist
          </AddButton>
        ) : null}
      </RepeatList>
    </div>
  );
}

function ChecklistEditor({ index: i, c, included, tasks, set }: { index: number; c: Proposal["checklists"][number]; included: boolean; tasks: string[]; set: Setter }) {
  return (
    <RepeatItem
      index={i}
      kind="Checklist"
      name={c.name}
      facts={checklistFacts(c, tasks)}
      included={included}
      onInclude={(v) => set((s) => void (s.include.checklists[i] = v))}
      onRemove={() => set((s) => { s.proposal.checklists.splice(i, 1); s.include.checklists.splice(i, 1); })}
      testId={`review-checklist-${i}`}
    >
      <ItemGrid>
        <FormField label="Name" required htmlFor={`c-name-${i}`} span={SPAN.four}>
          <Input id={`c-name-${i}`} value={c.name} maxLength={80} onChange={(e) => set((s) => void (s.proposal.checklists[i].name = e.target.value))} placeholder="Example: Grocery list" />
        </FormField>
        <FormField label="Goes with the recurring task" htmlFor={`c-task-${i}`} span={SPAN.five}>
          <NativeSelect id={`c-task-${i}`} value={c.recurring_task ?? ""} onChange={(e) => set((s) => void (s.proposal.checklists[i].recurring_task = e.target.value === "" ? null : Number(e.target.value)))}>
            <option value="">None</option>
            {tasks.map((t, j) => (
              <option key={j} value={j}>
                {t || `Recurring task ${j + 1}`}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Reset each week" htmlFor={`c-reset-${i}`} span={SPAN.three}>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input id={`c-reset-${i}`} type="checkbox" checked={c.reset_weekly} onChange={(e) => set((s) => void (s.proposal.checklists[i].reset_weekly = e.target.checked))} className="h-4 w-4 accent-primary" />
            Uncheck weekly
          </label>
        </FormField>
      </ItemGrid>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] gap-2 border-b border-border bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 @2xl/item:grid-cols-[minmax(0,1fr)_8rem_minmax(0,16rem)_2.25rem]">
          <span>Item</span>
          <span>Quantity</span>
          <span className="hidden @2xl/item:block">Notes</span>
          <span className="sr-only">Remove</span>
        </div>
        <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
          {c.items.map((it, j) => (
            <li key={j} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] items-center gap-2 px-3 py-1.5 @2xl/item:grid-cols-[minmax(0,1fr)_8rem_minmax(0,16rem)_2.25rem]">
              <Input aria-label={`Item ${j + 1}`} value={it.text} maxLength={160} className="h-8" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].text = e.target.value))} />
              <Input aria-label={`Quantity ${j + 1}`} value={it.quantity ?? ""} maxLength={40} className="h-8" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].quantity = e.target.value || null))} />
              <Input aria-label={`Notes ${j + 1}`} value={it.notes ?? ""} maxLength={200} className="hidden h-8 @2xl/item:flex" onChange={(e) => set((s) => void (s.proposal.checklists[i].items[j].notes = e.target.value || null))} />
              <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-slate-100" aria-label={`Remove ${it.text}`} onClick={() => set((s) => void s.proposal.checklists[i].items.splice(j, 1))} disabled={c.items.length <= 1}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Button type="button" size="sm" variant="outline" className="my-3" onClick={() => set((s) => void s.proposal.checklists[i].items.push({ text: "New item", quantity: null, notes: null }))} disabled={c.items.length >= 80}>
        <Plus /> Add item
      </Button>
    </RepeatItem>
  );
}

/** Savings idea drafts: "An initiative" or "A reduction action on the expense". */
export function IdeaModeChoice({ mode, setMode }: { mode: "initiative" | "reduction"; setMode: (m: "initiative" | "reduction") => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Turn this savings idea into</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          ["initiative", "An initiative", "A goal, a milestone, a plan, a steps checklist, and a budget target when the idea is about a category."],
          ["reduction", "A reduction action on the expense", "One action with a deadline and projected savings, listed in Finance, Budget."],
        ].map(([v, l, d]) => (
          <label key={v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", mode === v ? "border-primary bg-primary-soft/60" : "border-border")}>
            <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v as "initiative" | "reduction")} className="mt-1 accent-primary" />
            <span>
              <span className="block text-sm font-medium">{l}</span>
              <span className="clamp-2 text-xs text-muted-foreground">{d}</span>
            </span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- The review page (Open full page) ----------

export function DraftReview(props: { draftId: string; initial: State; initiatives: string[]; categories: string[]; categorySpend: Record<string, number>; savingsIdea: Idea | null; today: string }) {
  const [state, setState] = useState<State>(props.initial);
  const [mode, setMode] = useState<"initiative" | "reduction">("initiative");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialJson = useMemo(() => JSON.stringify(props.initial), [props.initial]);
  const json = JSON.stringify(state);
  const dirty = json !== initialJson && !saved;
  useUnsavedWork(dirty, "The review screen has edits that are not saved. Save edits keeps them; nothing is created until you press Approve selected.");

  const win = useAppWindow();
  const set: Setter = (fn) => {
    setSaved(false);
    setState((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  };
  const editor: EditorProps = { state, set, initiatives: props.initiatives, categories: props.categories, categorySpend: props.categorySpend, today: props.today, draftId: props.draftId };
  const { savings, basis, budgetCurrent } = draftSavings(state, props.categorySpend, props.savingsIdea?.estimate_basis);
  const { selected, total } = selectedCount(state);

  const summary = (
    <div className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card className="relative overflow-hidden border-action-stripe/25 bg-action-bg" id="next-action">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-action-stripe" />
        <CardHeader className="gap-1.5">
          <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">Next required action</CardDescription>
          <CardTitle className="text-lg font-semibold leading-snug">{mode === "reduction" ? "Check the reduction action, then approve it." : "Check each item, uncheck what you do not want, then press Approve selected."}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {savings !== null && savings !== undefined ? (
            <div className="rounded-lg border border-status-met/30 bg-white px-3 py-2" data-testid="estimated-savings">
              <p className="text-xs font-medium text-slate-700">Estimated monthly savings</p>
              <p className="tabular text-2xl font-semibold text-status-met">{usd(savings)} per month</p>
              <p className="text-xs text-muted-foreground">{basis}</p>
            </div>
          ) : null}
          {mode === "initiative" ? (
            <>
              <Button type="button" variant="outline" className="w-full bg-white" onClick={() => win.openSummary(summaryFromProposal(state.proposal, state.include, budgetCurrent), { onField: () => {} })}>
                <LayoutGrid /> View summary
              </Button>
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
              <GuardedForm
                action={saveDraftEdits}
                onResult={(r) => {
                  const e = (r as { error?: string } | null)?.error ?? null;
                  setError(e);
                  if (!e) setSaved(true);
                }}
                data-unsaved="off"
              >
                <input type="hidden" name="draft_id" value={props.draftId} />
                <input type="hidden" name="state" value={json} />
                <SubmitButton variant="outline" className="w-full bg-white" pendingText="Saving...">
                  {saved ? "Edits saved" : "Save edits (approve later)"}
                </SubmitButton>
              </GuardedForm>
            </>
          ) : null}
          {error ? (
            <p className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed" role="alert">
              {error}
            </p>
          ) : null}
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
        {props.savingsIdea ? <IdeaModeChoice mode={mode} setMode={setMode} /> : null}
        {mode === "reduction" && props.savingsIdea ? (
          <ReductionForm draftId={props.draftId} idea={props.savingsIdea} today={props.today} onError={setError} />
        ) : (
          <>
            <Section title="The initiative">
              <NameEditor {...editor} />
            </Section>
            <GoalsEditor {...editor} />
            <MilestonesEditor {...editor} />
            <TasksEditor {...editor} />
            <PlanChecklistsEditor {...editor} />
            <TargetBudgetEditor {...editor} />
          </>
        )}
      </div>
      <div className="order-1 min-w-0 lg:order-2">{summary}</div>
    </div>
  );
}

export function ReductionForm({ draftId, idea, today, onError }: { draftId: string; idea: Idea; today: string; onError: (e: string | null) => void }) {
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
