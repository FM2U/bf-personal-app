import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Data imports" };

export default async function ImportsSettingsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader
        title="Data imports"
        description="CSV upload with saved column layouts per bank or card. Simplifi by Quicken has no public API; use its CSV export."
        actions={
          <Button asChild size="sm">
            <Link href="/finance/import">Import a CSV file</Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <ListCard sb={supabase} table="import_layouts" />
        <ListCard sb={supabase} table="import_batches" limit={100} />
      </div>
    </div>
  );
}
