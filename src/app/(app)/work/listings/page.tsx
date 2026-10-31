import { requireOwner } from "@/lib/auth";
import { BUY_BOX } from "@/lib/work/buy-box";
import { loadListings } from "@/lib/work/data";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Quiet, Rows, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { AddListingButton, AddListingCard } from "@/components/app/work/add-listing";
import { ListingRow } from "@/components/app/work/listing-row";
import { PassedList } from "@/components/app/work/passed-list";

export const metadata = { title: "Screen listings" };

/**
 * Screen listings: Add a listing (paste text, the AI fills the fields), the listings to screen with the buy box
 * check and Pass or Interested, and the Passed list (collapsed, searchable) so no business is screened twice.
 */
export default async function ScreenListingsPage({ searchParams }: { searchParams: Promise<{ add?: string; saved?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const d = await loadListings(supabase, ownerId);
  const adding = sp.add === "1";
  return (
    <WorkShell testId="work-listings">
      <WorkHeader title="Screen listings" right={d.available ? <AddListingButton open={adding} /> : null} />
      <WorkTabs toScreen={d.available ? d.listings.length : null} />
      {!d.available ? (
        <WorkUpdateNotice />
      ) : (
        <div className="flex flex-col gap-5">
          {sp.saved ? (
            <p className="rounded-md bg-status-met-bg px-3 py-2 text-[13px] text-status-met" role="status" data-testid="listing-saved">
              Saved {sp.saved} to the list.
            </p>
          ) : null}
          {adding ? <AddListingCard /> : null}
          <WorkCard title="To screen" count={d.listings.length} hint={`Buy box: ${BUY_BOX.label}`} testId="to-screen-card">
            {d.listings.length ? (
              <Rows testId="listing-rows">
                {d.listings.map((l) => (
                  <ListingRow key={l.id} listing={l} />
                ))}
              </Rows>
            ) : (
              <Quiet testId="listings-empty">Nothing to screen. Add a listing when the next one comes in.</Quiet>
            )}
            <p className="px-[22px] pt-1 pb-4 text-[12.5px] text-muted-foreground">The green or amber mark is the buy box check on the numbers and the location; it is a hint, not a decision. Pass asks for one reason. Interested moves it into Deals at Interested.</p>
          </WorkCard>
          <PassedList rows={d.passed} />
        </div>
      )}
    </WorkShell>
  );
}
