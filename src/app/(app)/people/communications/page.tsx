import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";

export const metadata = { title: "Communication history" };

export default async function CommunicationsPage() {
  const { supabase } = await requireOwner();
  return (
    <div>
      <PageHeader title="Communication history" description="Every email, call, letter, or meeting, with date, method, summary, and the records it concerns. Example: a call with a broker appears on the broker's contact page and on the deal it concerns." />
      <ListCard sb={supabase} table="communications" limit={300} />
    </div>
  );
}
