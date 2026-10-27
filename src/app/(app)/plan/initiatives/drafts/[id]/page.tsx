import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader } from "@/components/app/page-header";
import { DraftReview } from "@/components/app/draft-review";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";
import { hasUpdate0014 } from "@/lib/update-0014";
import { categorySpendAverages, readDraftState } from "@/lib/initiative/server";
import type { Row } from "@/lib/types";

export const metadata = { title: "Review the initiative" };

export default async function DraftReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const backLink = (
    <Link href="/plan/start" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
      <ChevronLeft className="h-4 w-4" /> Start an initiative
    </Link>
  );
  if (!(await hasUpdate0014(supabase))) {
    return (
      <div>
        {backLink}
        <PageHeader title="Review the initiative" />
        <DbUpdateNotice file={DB_UPDATE_FILE_0014} features="Start an initiative appears after the update." />
      </div>
    );
  }
  const { data: draft } = await supabase.from("initiative_drafts").select("*").eq("id", id).maybeSingle();
  if (!draft) {
    return (
      <div>
        {backLink}
        <EmptyState title="This draft was not found." action={<Button asChild size="sm"><Link href="/plan/start">Start an initiative</Link></Button>} />
      </div>
    );
  }
  if (draft.status !== "draft") {
    const href = draft.result_initiative_id ? `/records/initiatives/${draft.result_initiative_id}` : draft.result_summary?.reduction_action_id ? `/records/reduction_actions/${draft.result_summary.reduction_action_id}` : "/plan";
    return (
      <div>
        {backLink}
        <PageHeader title="Review the initiative" />
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col items-start gap-3 pt-5">
            <p className="text-sm">{draft.status === "approved" ? "This draft was approved and its records were created." : "This draft was discarded. Nothing was created."}</p>
            {draft.status === "approved" ? (
              <Button asChild size="sm">
                <Link href={href}>Open what was created</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }
  const state = readDraftState(draft.proposal);
  if (!state) {
    return (
      <div>
        {backLink}
        <Notice tone="error">This draft could not be read. Discard it and start again.</Notice>
      </div>
    );
  }
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: inits }, { data: cats }, spend, ideaRes] = await Promise.all([
    supabase.from("initiatives").select("name").order("sort_order"),
    supabase.from("categories").select("id,name,kind").order("name"),
    categorySpendAverages(supabase, ownerId, ctx.today),
    draft.savings_idea_id ? supabase.from("savings_ideas").select("*").eq("id", draft.savings_idea_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const expense = ((cats ?? []) as Row[]).filter((c) => c.kind === "expense");
  const spendByName = Object.fromEntries(expense.filter((c) => spend[c.id] !== undefined).map((c) => [String(c.name).toLowerCase(), spend[c.id]]));
  const idea = ideaRes.data as Row | null;
  return (
    <div>
      {backLink}
      <PageHeader
        title={`Review: ${state.proposal.initiative.name}`}
        description={draft.source === "savings_idea" ? "From a savings idea. Edit any item, choose initiative or reduction action, then approve." : `From your words: "${String(draft.prompt).slice(0, 220)}${String(draft.prompt).length > 220 ? "..." : ""}"`}
      />
      {sp.notice ? (
        <div className="mb-4">
          <Notice>{sp.notice}</Notice>
        </div>
      ) : null}
      <DraftReview
        draftId={draft.id}
        initial={state}
        initiatives={((inits ?? []) as Row[]).map((i) => i.name)}
        categories={expense.map((c) => c.name)}
        categorySpend={spendByName}
        today={ctx.today}
        savingsIdea={
          idea
            ? {
                title: idea.title,
                steps: (idea.steps ?? []) as string[],
                estimated_monthly_savings: Number(idea.estimated_monthly_savings),
                estimate_basis: idea.estimate_basis ?? "",
                target_label: idea.target_label,
                current_monthly_cost: Number(idea.current_monthly_cost ?? 0),
              }
            : null
        }
      />
    </div>
  );
}
