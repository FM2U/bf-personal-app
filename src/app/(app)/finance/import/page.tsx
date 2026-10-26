import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "./import-wizard";
import type { SavedLayout } from "@/lib/calc/import-layout";
import type { Row } from "@/lib/types";

export const metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const { supabase } = await requireOwner();
  const [{ data: accounts }, { data: layouts }, { data: batches }] = await Promise.all([
    supabase.from("accounts").select("id,name,institution").eq("is_active", true).order("name"),
    supabase.from("import_layouts").select("*").order("name"),
    supabase.from("import_batches").select("account_id,layout_id,created_at").eq("source", "csv").not("layout_id", "is", null).order("created_at", { ascending: false }).limit(200),
  ]);
  // The layout used by the last import into each account fills the next import into that account.
  const lastLayoutByAccount: Record<string, string> = {};
  for (const b of (batches ?? []) as Row[]) if (b.account_id && !lastLayoutByAccount[b.account_id]) lastLayoutByAccount[b.account_id] = b.layout_id;
  return (
    <div>
      <PageHeader title="Import CSV" description="Each row is checked against existing transactions by the bank's transaction ID and by account, date, amount, and description, so the same transaction is never added twice." />
      <ImportWizard
        accounts={(accounts ?? []) as { id: string; name: string; institution: string | null }[]}
        layouts={(layouts ?? []) as Row[] as SavedLayout[]}
        lastLayoutByAccount={lastLayoutByAccount}
      />
    </div>
  );
}
