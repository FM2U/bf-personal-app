import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Lightbulb } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { EmptyState, Notice } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { approveSavingsIdea, declineSavingsIdea, editSavingsIdea, laterSavingsIdea, proposeSavingsNow } from "@/app/actions/savings";
import { aiBudget } from "@/lib/ai/claude";
import { loadSavingsIdeas, CAP_MESSAGE } from "@/lib/engine/savings-ideas";
import { isAIConfigured } from "@/lib/env";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";

const EFFORT: Record<string, "met" | "soon" | "missed"> = { low: "met", medium: "soon", high: "missed" };
const BACK = "/finance/expenses#savings-ideas";

function IdeaCard({ idea }: { idea: Row }) {
  const steps = (idea.steps ?? []) as string[];
  return (
    <Card data-testid="savings-idea">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="clamp-2 min-h-10">{idea.title}</CardTitle>
          <StatusBadge status={EFFORT[idea.effort] ?? "neutral"} className="shrink-0">
            {String(idea.effort).charAt(0).toUpperCase() + String(idea.effort).slice(1)} effort
          </StatusBadge>
        </div>
        <CardDescription className="clamp-1">
          {idea.target_label}: {money(idea.current_monthly_cost)} per month now
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-medium text-slate-700">Estimated monthly savings</p>
          <p className="tabular text-2xl font-semibold text-status-met" data-testid="idea-savings">{money(idea.estimated_monthly_savings)}</p>
          <p className="clamp-3 min-h-12 text-xs text-muted-foreground">{idea.estimate_basis}</p>
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-slate-800">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <div className="mt-auto grid grid-cols-3 gap-2">
          <GuardedForm action={approveSavingsIdea} className="col-span-3">
            <input type="hidden" name="id" value={idea.id} />
            <input type="hidden" name="back" value={BACK} />
            <SubmitButton size="sm" className="w-full" pendingText="Opening..." data-testid="idea-approve">
              Approve
            </SubmitButton>
          </GuardedForm>
          <details className="col-span-3 rounded-md border border-border [&[open]>summary]:mb-3">
            <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium">Edit</summary>
            <GuardedForm action={editSavingsIdea} className="px-3 pb-3">
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="back" value={BACK} />
              <FieldGrid cols={1}>
                <FormField label="Idea" htmlFor={`e-t-${idea.id}`}>
                  <Input id={`e-t-${idea.id}`} name="title" defaultValue={idea.title} maxLength={200} required />
                </FormField>
                <FormField label="Estimated monthly savings" htmlFor={`e-s-${idea.id}`}>
                  <Input id={`e-s-${idea.id}`} name="estimated_monthly_savings" type="number" min={0} step="0.01" defaultValue={idea.estimated_monthly_savings} required />
                </FormField>
                <FormField label="Effort" htmlFor={`e-e-${idea.id}`}>
                  <NativeSelect id={`e-e-${idea.id}`} name="effort" defaultValue={idea.effort}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </NativeSelect>
                </FormField>
                <FormField label="Steps (one per line)" htmlFor={`e-st-${idea.id}`}>
                  <Textarea id={`e-st-${idea.id}`} name="steps" rows={4} defaultValue={steps.join("\n")} />
                </FormField>
              </FieldGrid>
              <SubmitButton size="sm" variant="outline">Save idea</SubmitButton>
            </GuardedForm>
          </details>
          <details className="col-span-2 rounded-md border border-border [&[open]]:col-span-3 [&[open]>summary]:mb-2">
            <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium">Decline</summary>
            <GuardedForm action={declineSavingsIdea} className="flex flex-col gap-2 px-3 pb-3">
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="back" value={BACK} />
              <Input name="reason" placeholder="Reason (optional, one line)" aria-label="Reason for declining" maxLength={200} />
              <SubmitButton size="sm" variant="outline" data-testid="idea-decline">Decline idea</SubmitButton>
              <p className="text-xs text-muted-foreground">Ideas for this expense are not proposed again for 90 days.</p>
            </GuardedForm>
          </details>
          <GuardedForm action={laterSavingsIdea}>
            <input type="hidden" name="id" value={idea.id} />
            <input type="hidden" name="to" value="later" />
            <input type="hidden" name="back" value={BACK} />
            <SubmitButton size="sm" variant="ghost" className="w-full" pendingText="...">
              Later
            </SubmitButton>
          </GuardedForm>
        </div>
      </CardContent>
      <CardNote>Proposed {fmtDate(idea.batch_date)} from the last 90 days of spending.</CardNote>
    </Card>
  );
}

/** Finance, Expenses: "Savings ideas" (weekly AI proposals with Approve, Edit, Decline, Later) and "Propose savings ideas now". */
export async function SavingsIdeasSection({ sb, ownerId, notice }: { sb: SupabaseClient; ownerId: string; notice?: string }) {
  const ideas = await loadSavingsIdeas(sb);
  if (!ideas.available) {
    return (
      <section id="savings-ideas" className="mb-4">
        <DbUpdateNotice file={DB_UPDATE_FILE_0014} features="Weekly AI savings ideas appear after the update." />
      </section>
    );
  }
  const budget = await aiBudget(sb, ownerId);
  const total = ideas.pending.reduce((s, i) => s + Number(i.estimated_monthly_savings ?? 0), 0);
  return (
    <section id="savings-ideas" className="mb-4 flex flex-col gap-3 scroll-mt-4">
      {notice ? <Notice tone={/cap|failed|could not|not/i.test(notice) ? "warn" : "info"}>{notice}</Notice> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-slate-500" /> Savings ideas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Waiting for a decision</p>
              <p className="tabular text-2xl font-semibold">{ideas.pending.length}</p>
              {total ? <p className="text-sm text-status-met">About {money(total)} per month if all are done</p> : null}
            </div>
            {budget.blocked ? <Notice tone="warn">{CAP_MESSAGE}</Notice> : null}
            <GuardedForm action={proposeSavingsNow}>
              <input type="hidden" name="back" value={BACK} />
              <SubmitButton size="sm" variant="outline" className="w-full" disabled={!isAIConfigured() || budget.blocked} pendingText="The AI is reading 90 days of spending...">
                Propose savings ideas now
              </SubmitButton>
            </GuardedForm>
            {!isAIConfigured() ? <p className="text-xs text-muted-foreground">The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.</p> : null}
          </CardContent>
          <CardNote>Up to 3 ideas each week on your weekly review day, from the last 90 days by category, merchant, and recurring charge.</CardNote>
        </Card>
        {ideas.pending.length ? (
          ideas.pending.slice(0, 3).map((i) => <IdeaCard key={i.id} idea={i} />)
        ) : (
          <div className="md:col-span-1 xl:col-span-3">
            <EmptyState title="No savings ideas waiting." body="New ideas arrive on your weekly review day. Press Propose savings ideas now to get them today." />
          </div>
        )}
      </div>
      {ideas.pending.length > 3 || ideas.later.length ? (
        <Card>
          <CardHeader>
            <CardTitle>More ideas and saved for later</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-slate-100">
              {[...ideas.pending.slice(3), ...ideas.later].map((i) => (
                <li key={i.id} className="grid grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
                  <span className="min-w-0">
                    <Link href={`/records/savings_ideas/${i.id}`} className="clamp-1 text-sm font-medium hover:underline">{i.title}</Link>
                    <span className="clamp-1 text-xs text-muted-foreground">{i.target_label}{i.status === "later" ? " . saved for later" : ""}</span>
                  </span>
                  <span className="tabular text-sm text-status-met">{money(i.estimated_monthly_savings)}/mo</span>
                  <span className="flex gap-2">
                    <GuardedForm action={approveSavingsIdea}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="back" value={BACK} />
                      <SubmitButton size="sm" pendingText="...">Approve</SubmitButton>
                    </GuardedForm>
                    {i.status === "later" ? (
                      <GuardedForm action={laterSavingsIdea}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="to" value="pending" />
                        <input type="hidden" name="back" value={BACK} />
                        <SubmitButton size="sm" variant="outline" pendingText="...">Show again</SubmitButton>
                      </GuardedForm>
                    ) : null}
                    <GuardedForm action={declineSavingsIdea}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="back" value={BACK} />
                      <SubmitButton size="sm" variant="ghost" pendingText="...">Decline</SubmitButton>
                    </GuardedForm>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardNote>Later keeps an idea out of the count on Home; no new idea is proposed for the same expense until it is decided.</CardNote>
        </Card>
      ) : null}
    </section>
  );
}
