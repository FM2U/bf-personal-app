import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Milestones" };

export default async function MilestonesPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader
        title="Milestones"
        description="Each milestone has a measurable completion test, a due date, the tasks that produce it, proof of completion, and options written in advance for if it is missed. When a milestone is met, the next one becomes active. When it is missed, a decision record opens with those options."
      />
      <div className="flex flex-col gap-4">
        <ListCard sb={supabase} table="milestones" title="Active and planned" filters={[["status", "in", ["active", "planned"]]]} />
        <ListCard sb={supabase} table="milestones" title="Missed" filters={[["status", "eq", "missed"]]} emptyTitle="No missed milestones." emptyBody="A milestone past its due date without proof is marked missed and opens a decision." />
        <ListCard sb={supabase} table="milestones" title="Met" filters={[["status", "eq", "met"]]} emptyTitle="No milestones met yet." emptyBody="Mark a milestone met from its page after adding proof." />
      </div>
    </div>
  );
}
