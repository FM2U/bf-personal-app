import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO } from "@/lib/calc/dates";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return (
    <div>
      <PageHeader title="Contacts" description="Every person you work with: brokers, lenders, accountability partners, candidates, investors, employers. A follow-up date creates a task and a calendar event when the date arrives." />
      <div className="flex flex-col gap-4">
        <ListCard
          sb={supabase}
          table="contacts"
          title="Follow-ups in the next 14 days"
          filters={[["follow_up_date", "lte", addDaysISO(ctx.today, 14)]]}
          order={["follow_up_date", true]}
          columns={["name", "follow_up_date", "follow_up_note", "organization_id"]}
          emptyTitle="No follow-ups in the next 14 days."
          emptyBody="Set a follow-up date on a contact to get a task and a calendar event on that date."
        />
        <ListCard
          sb={supabase}
          table="contacts"
          title="All contacts"
          filter={{
            path: "/people",
            sp,
            today: ctx.today,
            columns: [["relationship_group"], ["roles"], ["organization_id"], ["follow_up_date", "is_deal_source", "is_consulting_lead"]],
            dateModes: { follow_up_date: "due" },
            titles: { follow_up_date: "Follow-up date", relationship_group: "Relationship group" },
          }}
        />
      </div>
    </div>
  );
}
