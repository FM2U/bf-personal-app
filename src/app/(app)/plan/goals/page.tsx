import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Goals" description='A target, a deadline, and a measured number. Example: "Monthly spending under $6,000 by March 1, 2027."' />
      <div className="flex flex-col gap-4">
        <ListCard sb={supabase} table="goals" title="Active goals" filters={[["status", "eq", "active"]]} columns={["title", "initiative_id", "metric_key", "target_value", "deadline", "status"]} />
        <ListCard sb={supabase} table="goals" title="Met, missed, or dropped" filters={[["status", "neq", "active"]]} columns={["title", "initiative_id", "target_value", "deadline", "status"]} emptyTitle="No closed goals yet." emptyBody="Goals appear here once they are met, missed, or dropped." />
      </div>
    </div>
  );
}
