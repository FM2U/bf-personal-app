import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Organizations" description="Brokers, lenders, employers, investors, and other organizations. Each page shows its people, pipeline items, and communication history." />
      <ListCard sb={supabase} table="organizations" />
    </div>
  );
}
