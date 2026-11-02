"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { buyBoxHint, moneyShort, type BuyBoxSettings } from "@/lib/work/buy-box";
import type { ListingRow as ListingRowData, PassedRow } from "@/lib/work/data";
import { matchesSearch } from "@/lib/work/phases";
import { ListingRow } from "@/components/app/work/listing-row";
import { useSections } from "@/components/app/work/sections";
import { FilterRow, Line1, Line3, Name, Pill, PinnedBlock, Quiet, RowShell, SectionHeading } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Screen listings (mockup v6, approved 2026-10-31): the title with Add a listing, the Work tabs, and the filter row
 * (All, Fits buy box, Near fit, Does not fit, Passed, Find, Collapse all; Near fit added by AI instructions revision 1)
 * stay at the top; the page scrolls as one. Two cards
 * with charcoal small-caps headings that collapse: "To screen" (the buy box line at the right, Pass and Interested on
 * each row) and "Passed" (kept so no business is screened twice; collapsed by default, up to 200 rows). A filter
 * shows only the matching rows, opens the section with matches and collapses the other; Find narrows both by name.
 */
const STORAGE_KEY = "work-listings-sections";

type ListingFilter = "all" | "fit" | "near" | "nofit" | "passed";

const FILTERS: readonly { key: ListingFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fit", label: "Fits buy box" },
  { key: "near", label: "Near fit" },
  { key: "nofit", label: "Does not fit" },
  { key: "passed", label: "Passed" },
];

const PASSED_SHOWN = 200;

export function ListingsBoard({ header, listings, passed, buyBox, children }: { /** The title, the Add a listing button, and the Work tabs (server-rendered). */ header: React.ReactNode; listings: ListingRowData[]; passed: PassedRow[]; /** The Buy box settings (the hint, and the reasons in the listing popup). */ buyBox: BuyBoxSettings; /** The Add a listing form and the "Saved" line, above the lists. */ children?: React.ReactNode }) {
  const [filter, setFilter] = useState<ListingFilter>("all");
  const [query, setQuery] = useState("");

  // The filter decides which rows (and which section opens); Find narrows inside the open sections.
  const listingInFilter = (l: ListingRowData) => filter === "all" || (filter === "fit" && l.buyBox.tier === "fits") || (filter === "near" && l.buyBox.tier === "near") || (filter === "nofit" && l.buyBox.tier === "outside");
  const passedInFilter = () => filter === "all" || filter === "passed";
  const listingShown = (l: ListingRowData) => listingInFilter(l) && matchesSearch(l, query);
  const passedShown = (p: PassedRow) => passedInFilter() && matchesSearch({ ...p, status: "open", nextAction: null, nextActionDue: null, waitLevel: "none" }, query);
  const counts = useMemo<Record<ListingFilter, number>>(() => ({ all: listings.length, fit: listings.filter((l) => l.buyBox.tier === "fits").length, near: listings.filter((l) => l.buyBox.tier === "near").length, nofit: listings.filter((l) => l.buyBox.tier === "outside").length, passed: passed.length }), [listings, passed]);
  const states = useMemo(
    () => [
      { name: "To screen", count: listings.length, hasMatch: listings.some(listingInFilter) },
      { name: "Passed", count: passed.length, hasMatch: passed.length > 0 && passedInFilter(), defaultOpen: false },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listings, passed, filter],
  );
  const sections = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: ListingFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };
  const toScreenClosed = sections.isCollapsed("To screen");
  const passedClosed = sections.isCollapsed("Passed");
  const passedList = passed.filter(passedShown);

  return (
    <>
      <PinnedBlock testId="listings-sticky">
        {header}
        <FilterRow prefix="listings" filters={FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find" collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </PinnedBlock>
      <div className="flex flex-col gap-[18px]">
        {children}
        <section className="rounded-xl border border-border bg-white px-[22px] pt-1 pb-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="to-screen-card" data-collapsed={toScreenClosed ? "1" : "0"}>
          <SectionHeading name="To screen" count={listings.length} collapsed={toScreenClosed} onToggle={() => sections.toggle("To screen")} hint={`Buy box: ${buyBoxHint(buyBox)}`} dataAttrs={{ "data-section": "to-screen" }} />
          {!listings.length ? (
            <Quiet className="px-0" testId="listings-empty">
              Nothing to screen. Add a listing when the next one comes in.
            </Quiet>
          ) : !toScreenClosed ? (
            <>
              <div className="-mx-[22px] flex flex-col pt-1" data-testid="listing-rows">
                {listings.map((l) => (
                  <ListingRow key={l.id} listing={l} hidden={!listingShown(l)} buyBox={buyBox} />
                ))}
                {!listings.some(listingShown) ? (
                  <Quiet testId="listings-no-match">
                    {query.trim() ? `Nothing to screen matches "${query.trim()}".` : "Nothing to screen matches this filter."}
                  </Quiet>
                ) : null}
              </div>
              <p className="pt-3 pb-1 text-[12.5px] text-muted-foreground">The mark is the buy box check on the numbers and the location (green Fits, amber Near fit, gray Outside); it is a hint, not a decision. Change the buy box in Settings, Buy box. Pass asks for one reason. Interested moves it into Deals at Interested and the AI drafts the open questions.</p>
            </>
          ) : null}
        </section>
        <section className="rounded-xl border border-border bg-white px-[22px] pt-1 pb-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="passed-card" data-collapsed={passedClosed ? "1" : "0"}>
          <SectionHeading name="Passed" count={passed.length} collapsed={passedClosed} onToggle={() => sections.toggle("Passed")} hint="Kept so you never re-screen the same business" dataAttrs={{ "data-section": "passed" }} />
          {!passed.length ? (
            <Quiet className="px-0" testId="passed-empty">
              Nothing passed yet.
            </Quiet>
          ) : !passedClosed ? (
            passedList.length ? (
              <div className="-mx-[22px] flex flex-col pt-1" data-testid="passed-rows">
                {passedList.slice(0, PASSED_SHOWN).map((r) => (
                  <RowShell key={r.id} href={`/work/deals/${r.id}`} testId="passed-row" className={cn("border-t border-slate-100 first:border-t-0")}>
                    <Line1>
                      <Name>{r.name}</Name>
                      <Pill testId="passed-reason">{r.reasonLabel}</Pill>
                    </Line1>
                    <Line3>{[r.date, r.earnings !== null ? `${moneyShort(r.earnings)} ${r.earningsLabel ?? ""}`.trim() : null, r.location].filter(Boolean).join(" · ")}</Line3>
                  </RowShell>
                ))}
                {passedList.length > PASSED_SHOWN ? (
                  <Quiet>
                    {passedList.length - PASSED_SHOWN} more. Narrow with Find, or see{" "}
                    <Link href="/work/deals" className="text-primary-strong hover:underline">
                      Deals
                    </Link>
                    .
                  </Quiet>
                ) : null}
              </div>
            ) : (
              <Quiet className="px-0" testId="passed-empty">
                Nothing passed matches &quot;{query.trim()}&quot;.
              </Quiet>
            )
          ) : null}
        </section>
      </div>
    </>
  );
}
