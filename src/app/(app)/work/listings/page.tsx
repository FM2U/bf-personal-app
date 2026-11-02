import { DB_UPDATE_NOTICE_0027 } from "@/lib/schema-guard";
import { requireOwner } from "@/lib/auth";
import { loadListings, loadTabCounts } from "@/lib/work/data";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { AddListingButton, AddListingCard } from "@/components/app/work/add-listing";
import { ListingsBoard } from "@/components/app/work/listings-board";

export const metadata = { title: "Screen listings" };

/**
 * Screen listings: Add a listing (paste text, the AI fills the fields, two name fields), the listings to screen with
 * the buy box check and Pass or Interested, and the Passed list (collapsed, searchable) so no business is screened
 * twice. The filter row and Collapse all are in src/components/app/work/listings-board.tsx.
 */
export default async function ScreenListingsPage({ searchParams }: { searchParams: Promise<{ add?: string; saved?: string; text?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const d = await loadListings(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, d.today);
  const adding = sp.add === "1";
  const header = (
    <>
      <WorkHeader
        title="Screen listings"
        right={
          <>
            {d.available ? <AddListingButton open={adding} /> : null}
            <AskAiPill context={{ page: "listings", label: "Screen listings" }} />
          </>
        }
      />
      <WorkTabs toScreen={d.available ? d.listings.length : null} outreachDue={tabs.outreachDue} />
    </>
  );
  return (
    <WorkShell testId="work-listings">
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <ListingsBoard header={header} listings={d.listings} passed={d.passed}>
          {sp.saved ? (
            <p className="rounded-md bg-status-met-bg px-3 py-2 text-[13px] text-status-met" role="status" data-testid="listing-saved">
              Saved {sp.saved} to the list.
              {/* Fix 2026-11-02: before database update 0027 the pasted text is not kept. */}
              {sp.text === "not-kept" ? <span className="text-status-soon" data-testid="listing-text-not-kept"> {DB_UPDATE_NOTICE_0027}</span> : null}
            </p>
          ) : null}
          {adding ? <AddListingCard /> : null}
        </ListingsBoard>
      )}
    </WorkShell>
  );
}
