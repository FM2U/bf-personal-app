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
        description="Each milestone has a measurable completion test, a due date, the tasks that produce it, proof, and options written in advance for if it is missed. When one is met, the next becomes active; when one is missed, a decision opens with those options."
      />
      <div className="flex flex-col gap-4">
        {/* Full width: enough columns to use it (milestone, goal, completion test, target, due date, status). */}
        <ListCard sb={supabase} table="milestones" title="Active and planned" filters={[["status", "in", ["active", "planned"]]]} columns={["title", "goal_id", "completion_test", "target_value", "due_date", "status"]} order={["due_date", true]} />
        {/* Shorter lists side by side. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <ListCard sb={supabase} table="milestones" title="Missed" filters={[["status", "eq", "missed"]]} columns={["title", "goal_id", "due_date"]} hideAdd emptyTitle="No missed milestones." emptyBody="A milestone past its due date without proof is marked missed and opens a decision." />
          <ListCard sb={supabase} table="milestones" title="Met" filters={[["status", "eq", "met"]]} columns={["title", "goal_id", "due_date"]} hideAdd emptyTitle="No milestones met yet." emptyBody="Mark one met from its page after adding proof." />
        </div>
      </div>
    </div>
  );
}
