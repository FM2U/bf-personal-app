import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { ProposalCard } from "@/components/app/proposal-card";
import { approveAllCategories } from "@/app/actions/ai";
import { labelMap, loadRefOptions } from "@/lib/data";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "AI proposals" };

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("ai_proposals").select("*").eq("status", "pending").order("created_at", { ascending: false });
  const list = (data ?? []) as Row[];
  const labels = labelMap(await loadRefOptions(supabase, ["categories", "initiatives", "goals", "milestones", "contacts", "organizations", "accounts", "pipelines", "pipeline_stages"]));
  const categories = list.filter((p) => p.source === "category_suggestion");
  const others = list.filter((p) => p.source !== "category_suggestion");
  const groups: Record<string, Row[]> = {};
  for (const p of others) (groups[p.group_id ?? p.id] ??= []).push(p);
  return (
    <div>
      <PageHeader title="AI proposals" description="Every change the AI suggests waits here. A change is saved only after you approve it, and the change log records it as approved AI change." />
      {sp.notice ? (
        <div className="mb-4">
          <Notice>{sp.notice}</Notice>
        </div>
      ) : null}
      {!list.length ? (
        <div className="max-w-3xl">
        <EmptyState title="No proposals waiting." body="Ask the AI in the chat panel, request reduction suggestions on an expense, or ask for category suggestions in Expenses." />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.entries(groups).map(([g, ps]) => (
            <section key={g}>
              {ps.length > 1 ? <p className="mb-2 text-sm font-medium">Choose one of these {ps.length} options</p> : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ps.map((p) => (
                  <ProposalCard key={p.id} p={p} back="/proposals" labels={labels} />
                ))}
              </div>
            </section>
          ))}
          {categories.length ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Category suggestions ({categories.length})</CardTitle>
                  <CardDescription>Approve one at a time, or approve all of them.</CardDescription>
                </div>
                <GuardedForm action={approveAllCategories}>
                  <input type="hidden" name="back" value="/proposals" />
                  <SubmitButton size="sm" pendingText="Approving...">
                    Approve all {categories.length}
                  </SubmitButton>
                </GuardedForm>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {categories.map((p) => (
                    <ProposalCard key={p.id} p={p} back="/proposals" labels={labels} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
