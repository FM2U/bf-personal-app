import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "./import-wizard";
import type { Row } from "@/lib/types";

export const metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const { supabase } = await requireOwner();
  const [{ data: accounts }, { data: layouts }] = await Promise.all([
    supabase.from("accounts").select("id,name,institution").eq("is_active", true).order("name"),
    supabase.from("import_layouts").select("*").order("name"),
  ]);
  return (
    <div>
      <PageHeader title="Import CSV" description="Each row is checked against existing transactions by the bank's transaction ID and by account, date, amount, and description, so the same transaction is never added twice." />
      <ImportWizard accounts={(accounts ?? []) as { id: string; name: string; institution: string | null }[]} layouts={(layouts ?? []) as Row[] as never} />
    </div>
  );
}
