"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markInterested, passDeal } from "@/app/actions/work";
import { date as fmtDate } from "@/lib/format";
import { moneyShort, PASS_REASONS, type PassReason } from "@/lib/work/buy-box";
import type { ListingRow as ListingRowData } from "@/lib/work/data";
import { PassMenu } from "@/components/app/work/pass-menu";
import { ListingPopup } from "@/components/app/work/listing-popup";
import { Confirm, FIGURE_COLS_GAP, Line1, Line2, Line3, Pill, ROW_COLS, RowButton, RowButtons, RowShell, Stat } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

export { PassMenu };

/**
 * One listing to screen: name (a button that opens the listing popup, Edit batch C round 2) and the buy box pill, what it does, source, broker and location, the three figures,
 * Pass (reason menu) and Interested (soft blue), each figure in a fixed column. After either the row shows one line, then leaves the list.
 * `hidden` keeps the row in the page but out of sight (the filter pills and Find on Screen listings).
 * Edit batch C round 3: a click anywhere on the row outside its buttons opens the popup too (the shared hover).
 */
export function ListingRow({ listing, hidden = false }: { listing: ListingRowData; hidden?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [popup, setPopup] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "blue"; text: string } | null>(null);
  const refresh = () => setTimeout(() => router.refresh(), 1500);

  const pass = (reason: PassReason) =>
    start(async () => {
      setPopup(false);
      const r = await passDeal(listing.id, reason);
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setResult({ tone: "blue", text: `${listing.name} passed: ${(PASS_REASONS.find((x) => x.value === reason)?.label ?? reason).toLowerCase()}. Kept in the Passed list.` });
      refresh();
    });
  const interested = () =>
    start(async () => {
      setPopup(false);
      const r = await markInterested(listing.id);
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setResult({ tone: "ok", text: `${listing.name} is now a deal at Interested. Next action: ${r.nextAction ? r.nextAction.charAt(0).toLowerCase() + r.nextAction.slice(1) : "set it on the deal"}, due ${r.due ? fmtDate(r.due, "EEE MMM d") : "soon"}.${r.questions ? " Open questions drafted by the AI on the deal." : ""}` });
      refresh();
    });

  if (result) {
    return (
      <RowShell testId="listing-row" dataAttrs={{ "data-listing": listing.id, "data-hidden": hidden ? "1" : "0" }} className={cn(hidden && "hidden")}>
        <Confirm tone={result.tone} testId="listing-result">
          <span>{result.text}</span>
          {result.tone === "warn" ? <RowButton onClick={() => setResult(null)}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }

  const meta = [listing.source, listing.brokerName, listing.location].filter(Boolean).join(" · ");
  return (
    <RowShell
      testId="listing-row"
      dataAttrs={{ "data-listing": listing.id, "data-fits": listing.buyBox.fits ? "1" : "0", "data-hidden": hidden ? "1" : "0" }}
      className={cn(hidden && "hidden")}
      onOpen={() => setPopup(true)}
      openLabel={`Open ${listing.name}`}
      right={
        <>
          <div className={cn("flex items-end", FIGURE_COLS_GAP.cls)} data-testid="listing-figures">
            <Stat value={moneyShort(listing.revenue)} label="Revenue" testId="listing-revenue-stat" />
            <Stat value={listing.earnings === null ? "Not stated" : moneyShort(listing.earnings)} label={listing.earningsLabel ?? "EBITDA"} testId="listing-earnings-stat" />
            <Stat value={moneyShort(listing.askingPrice)} label="Asking" testId="listing-asking-stat" />
          </div>
          <RowButtons>
            <PassMenu onPick={pass} pending={pending} />
            <RowButton tone="soft" onClick={interested} disabled={pending} className={ROW_COLS.wideButton.cls} data-testid="interested-button">
              {pending ? "Saving" : "Interested"}
            </RowButton>
          </RowButtons>
        </>
      }
    >
      <Line1>
        <button type="button" onClick={() => setPopup(true)} className="text-left text-sm font-semibold text-slate-900 underline-offset-2 hover:text-primary-strong hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-haspopup="dialog" title="Open the listing" data-testid="listing-name-button">
          {listing.name}
        </button>
        <Pill tone={listing.buyBox.fits ? "green" : "amber"} testId="buy-box-pill">
          {listing.buyBox.label}
        </Pill>
      </Line1>
      {listing.whatItDoes ? <Line2>{listing.whatItDoes}</Line2> : null}
      {meta ? <Line3>{meta}</Line3> : null}
      {popup ? <ListingPopup listing={listing} open={popup} onOpenChange={setPopup} onPass={pass} onInterested={interested} pending={pending} /> : null}
    </RowShell>
  );
}
