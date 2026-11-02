"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import { buyBoxTone, type BuyBoxSettings, type PassReason } from "@/lib/work/buy-box";
import type { ListingRow as ListingRowData } from "@/lib/work/data";
import { listingPopup } from "@/lib/work/listing-popup";
import { AddLinkInline, DealFactsForm, Fact } from "@/components/app/work/deal/cards";
import { PassMenu } from "@/components/app/work/pass-menu";
import { Pill, ROW_COLS, RowButton, RowLink } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The listing popup (Edit batch C round 2, item 2): pressing a listing's name on Screen listings opens a centered
 * window with the name and "Listed as" (or "Company not named yet"), the buy box pill and the reasons behind it, what
 * the business does, the facts (revenue, EBITDA or SDE, asking with the multiple, location, industry, source, broker,
 * why selling), and "Open the original listing" (a new tab) when there is a link. Edit turns the facts into the deal
 * page's Facts form in the same window; Pass (the reason menu) and Interested act as on the row and close the window,
 * and the row shows the result. Escape, a click outside, or the close mark closes it; the focus stays inside it.
 * Edit batch C round 3: "Open full page" next to Edit opens the listing's record page (/work/deals/[id] in the Listing
 * state); with no link to the original listing the footer has an "Add link" field instead (Enter or Save).
 */
export function ListingPopup({ listing, buyBox, open, onOpenChange, onPass, onInterested, pending }: { listing: ListingRowData; /** The Buy box settings the reasons are read against (the defaults when not given). */ buyBox?: BuyBoxSettings; open: boolean; onOpenChange: (open: boolean) => void; onPass: (reason: PassReason) => void; onInterested: () => void; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const d = listingPopup(listing, buyBox);
  const close = (o: boolean) => {
    if (!o) {
      setEditing(false);
      setSaved(false);
    }
    onOpenChange(o);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/30" data-testid="listing-popup-overlay" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-border bg-white shadow-[0_12px_40px_rgba(15,23,42,0.18)] focus:outline-none"
          data-testid="listing-popup"
          data-listing={listing.id}
        >
          <div className="flex items-start justify-between gap-4 border-b border-rule px-[22px] pt-5 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <DialogPrimitive.Title className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900" data-testid="listing-popup-title">
                  {d.title}
                </DialogPrimitive.Title>
                <Pill tone={buyBoxTone(d.tier)} testId="listing-popup-pill">
                  {d.pill}
                </Pill>
              </div>
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted-foreground" data-testid="listing-popup-under">
                {d.under}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="-mt-1 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Close" data-testid="listing-popup-close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {editing ? (
            <DealFactsForm
              deal={listing}
              testId="listing-popup-form"
              showFinancing={false}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setSaved(true);
              }}
            />
          ) : (
            <>
              <div className="px-[22px] pt-4" data-testid="listing-popup-buy-box">
                <div className="label-caps figure-label mb-1.5">Buy box check</div>
                <ul className="flex flex-col gap-1">
                  {d.reasons.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-[13px] text-slate-700" data-testid="listing-popup-reason">
                      <i className={cn("mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full", /^(Size fits|Location fits)/.test(r) ? "bg-status-met-solid" : /^No /.test(r) ? "bg-status-neutral-solid" : /^(Near fit|Location:)/.test(r) ? "bg-status-soon-solid" : "bg-status-missed-solid")} aria-hidden />
                      <span className="min-w-0">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {d.whatItDoes ? (
                <div className="px-[22px] pt-4" data-testid="listing-popup-what">
                  <div className="label-caps figure-label mb-1">What it does</div>
                  <p className="text-sm text-slate-800">{d.whatItDoes}</p>
                </div>
              ) : null}
              <div className="mx-[22px] mt-4 grid grid-cols-2 gap-x-[18px] gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-4" data-testid="listing-popup-facts">
                {d.facts.map((f) => (
                  <Fact key={f.key} label={f.label} testId={`listing-popup-fact-${f.key}`}>
                    {f.value}
                    {f.note ? <span className="font-normal text-muted-foreground"> ({f.note})</span> : null}
                  </Fact>
                ))}
              </div>
              {saved ? (
                <p className="px-[22px] pt-3 text-[13px] font-medium text-status-met" role="status" data-testid="listing-popup-saved">
                  Saved
                </p>
              ) : null}
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-4">
            {d.link ? (
              <a href={d.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary-strong hover:underline" data-testid="listing-popup-link">
                Open the original listing <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <div className="min-w-0 flex-1 basis-[260px]" data-testid="listing-popup-no-link">
                <AddLinkInline dealId={listing.id} testId="listing-popup-add-link" />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <RowLink href={`/work/deals/${listing.id}`} data-testid="listing-popup-full-page">
                Open full page
              </RowLink>
              {!editing ? (
                <RowButton onClick={() => setEditing(true)} disabled={pending} data-testid="listing-popup-edit">
                  Edit
                </RowButton>
              ) : null}
              <PassMenu onPick={onPass} pending={pending} testId="listing-popup-pass" up />
              <RowButton tone="soft" onClick={onInterested} disabled={pending} className={ROW_COLS.wideButton.cls} data-testid="listing-popup-interested">
                {pending ? "Saving" : "Interested"}
              </RowButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
