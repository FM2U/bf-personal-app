import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Decisions Log" };

export default async function DecisionsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Decisions Log" description="Each major choice, the options considered, the numbers for each option, the date decided, and the outcome." />
      <div className="flex flex-col gap-4">
        <ListCard sb={supabase} table="decisions" title="Open decisions" filters={[["status", "eq", "open"]]} emptyTitle="No open decisions." emptyBody="Decisions open here when a milestone is missed, a decision condition is met, or you add one." />
        <ListCard sb={supabase} table="decisions" title="Decided" filters={[["status", "eq", "decided"]]} emptyTitle="No decisions recorded yet." />
      </div>
    </div>
  );
}
