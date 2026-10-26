import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Categories" description='Expense categories and rules. Example rule: "any charge from Public Storage = Storage". Category corrections you make can be saved as rules.' />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ListCard sb={supabase} table="categorization_rules" />
        <ListCard sb={supabase} table="categories" />
      </div>
    </div>
  );
}
