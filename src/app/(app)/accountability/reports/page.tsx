import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Partner reports" };

export default async function ReportsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Partner reports" description="A saved copy of the numbers at send time, so a report never changes after it is finalized. Drafts are created on each partner's schedule." />
      <div className="flex flex-col gap-4">
        <ListCard sb={supabase} table="partner_reports" title="Drafts to review and finalize" filters={[["status", "eq", "draft"]]} emptyTitle="No drafts." emptyBody="Drafts are created on each partner's report date, or from a partner's page with Create a report now." />
        <ListCard sb={supabase} table="partner_reports" title="Finalized" filters={[["status", "eq", "finalized"]]} emptyTitle="No finalized reports yet." />
      </div>
    </div>
  );
}
