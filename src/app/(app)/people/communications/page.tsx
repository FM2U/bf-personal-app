import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { loadCtx } from "@/lib/engine/helpers";

export const metadata = { title: "Communication history" };

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return (
    <div>
      <PageHeader title="Communication history" description="Every email, call, letter, or meeting, with date, method, summary, and the records it concerns. Example: a call with a broker appears on the broker's contact page and on the deal it concerns." />
      <ListCard
        sb={supabase}
        table="communications"
        limit={500}
        filter={{
          path: "/people/communications",
          sp,
          today: ctx.today,
          columns: [["method"], ["direction", "occurred_at"], ["outcome", "is_outreach"], ["organization_id"]],
          dateModes: { occurred_at: "past" },
          titles: { occurred_at: "Date", is_outreach: "Counts as outreach" },
        }}
      />
    </div>
  );
}
