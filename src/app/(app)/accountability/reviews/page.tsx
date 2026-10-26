import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { SubmitButton } from "@/components/app/submit-button";
import { startReview } from "@/app/actions/domain";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Reviews" };

const KINDS = [
  { kind: "daily", title: "Daily close", body: "About 3 minutes, evening. Check off today's tasks, one reason for the commitments and targets missed today (or one per item), tomorrow's top 3 tasks." },
  { kind: "weekly", title: "Weekly review", body: "What changed, missed commitments, tasks moved 5 or more times, pipeline movement, spending vs. budget, next week's priorities, partner report draft." },
  { kind: "monthly", title: "Monthly review", body: "Budget vs. actual, net worth change, savings progress, debt payments confirmed, milestone status, connection status, full data export downloaded." },
  { kind: "quarterly", title: "Quarterly review", body: "Goal progress per initiative, decision conditions due this quarter, Inputs and Assumptions reviewed, next quarter's milestones set." },
];

export default async function ReviewsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Reviews" description="Required reviews, scheduled on Google Calendar. Each review is drafted by the AI from the data and completed by you." />
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((k) => (
          <Card key={k.kind}>
            <CardHeader>
              <CardTitle>{k.title}</CardTitle>
              <CardDescription className="clamp-4 min-h-20">{k.body}</CardDescription>
            </CardHeader>
            <CardContent>
              <GuardedForm action={startReview}>
                <input type="hidden" name="kind" value={k.kind} />
                <SubmitButton size="sm" variant="outline" pendingText="Drafting...">
                  {k.kind === "daily" ? "Open today's daily close" : `Open the latest ${k.kind} review`}
                </SubmitButton>
              </GuardedForm>
            </CardContent>
          </Card>
        ))}
      </div>
      <ListCard sb={supabase} table="reviews" title="All reviews" limit={200} emptyTitle="No reviews yet." emptyBody="Reviews are drafted on schedule by the morning and evening jobs. You can also open one now with the buttons above." />
    </div>
  );
}
