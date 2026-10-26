import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { getGoogleConnection } from "@/lib/google";
import { Notice, PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { SubmitButton } from "@/components/app/submit-button";
import { addTimeBlocks } from "@/app/actions/domain";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Calendar time blocks" };

export default async function CalendarPage() {
  const { supabase, ownerId } = await requireOwner();
  const google = await getGoogleConnection(supabase, ownerId);
  const connected = google?.status === "connected";
  return (
    <div>
      <PageHeader
        title="Calendar time blocks"
        description="The app adds time blocks to Google Calendar for priority tasks and reviews each morning. Block length and number per day are set in Inputs and Assumptions."
        actions={
          <GuardedForm action={addTimeBlocks}>
            <SubmitButton size="sm" disabled={!connected} pendingText="Adding...">
              Add today&apos;s time blocks now
            </SubmitButton>
          </GuardedForm>
        }
      />
      {!connected ? (
        <div className="mb-4">
          <Notice tone="warn">
            Google is not connected, so no events can be added. <Link href="/settings" className="font-medium underline">Connect Google</Link>.
          </Notice>
        </div>
      ) : null}
      <ListCard sb={supabase} table="calendar_events" limit={200} emptyTitle="No time blocks yet." emptyBody="Time blocks appear here after the morning job or after pressing Add today's time blocks now." />
    </div>
  );
}
