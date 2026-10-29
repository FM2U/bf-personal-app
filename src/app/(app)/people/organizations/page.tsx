import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { loadCtx } from "@/lib/engine/helpers";

export const metadata = { title: "Organizations" };

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return (
    <div>
      <PageHeader title="Organizations" description="Brokers, lenders, employers, investors, and other organizations. Each page shows its people, pipeline items, and communication history." />
      <ListCard sb={supabase} table="organizations" filter={{ path: "/people/organizations", sp, today: ctx.today, columns: [["kind"]] }} />
    </div>
  );
}
