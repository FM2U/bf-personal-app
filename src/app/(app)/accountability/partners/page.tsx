import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Accountability partners" };

export default async function PartnersPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader
        title="Accountability partners"
        description="Any person or entity, recorded by real name or pseudonym. A partner is required to do nothing. Choose the sections each partner sees, the report schedule (weekly, every two weeks, or monthly), and the delivery method (email, phone call script, or printed letter). An email is sent only after you confirm it, or saved as a Gmail draft."
      />
      <ListCard sb={supabase} table="partners" columns={["name", "schedule", "delivery_methods", "next_report_on", "is_active"]} />
    </div>
  );
}
