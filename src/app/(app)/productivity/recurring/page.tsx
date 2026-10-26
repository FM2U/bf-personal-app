import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { SubmitButton } from "@/components/app/submit-button";
import { runTodaysJobs } from "@/app/actions/domain";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Recurring tasks" };

const CADENCES: [string, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
];

export default async function RecurringPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader
        title="Recurring tasks"
        description="Daily, weekly, monthly, and quarterly task lists generated from these templates each morning."
        actions={
          <GuardedForm action={runTodaysJobs}>
            <SubmitButton size="sm" variant="outline" pendingText="Creating...">
              Create today&apos;s tasks now
            </SubmitButton>
          </GuardedForm>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {CADENCES.map(([c, label]) => (
          <ListCard key={c} sb={supabase} table="task_templates" title={label} filters={[["cadence", "eq", c]]} prefill={{ cadence: c }} columns={["title", "initiative_id", "is_commitment", "is_active"]} emptyTitle={`No ${label.toLowerCase()} tasks.`} emptyBody={`Add a ${label.toLowerCase()} template. A task is created from it on each due day.`} />
        ))}
      </div>
    </div>
  );
}
