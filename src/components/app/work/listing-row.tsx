"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markInterested, passDeal } from "@/app/actions/work";
import { date as fmtDate } from "@/lib/format";
import { moneyShort, PASS_REASONS, type PassReason } from "@/lib/work/buy-box";
import type { ListingRow as ListingRowData } from "@/lib/work/data";
import { Confirm, Line1, Line2, Line3, Name, Pill, ROW_COLS, RowButton, RowButtons, RowShell, Stat } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Pass menu: one button that opens the seven reasons; one click passes. Used on listing rows and on the deal page.
 * `onPick` runs the save; the menu closes itself on a click outside or Escape.
 */
export function PassMenu({ onPick, label = "Pass", pending, tone = "outline", testId = "pass-button", align = "right", className }: { onPick: (reason: PassReason) => void; label?: string; pending?: boolean; tone?: "outline" | "primary"; testId?: string; align?: "right" | "left"; /** The button's size (the page header uses the taller 36px buttons). */ className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-block">
      <RowButton tone={tone} onClick={() => setOpen((o) => !o)} disabled={pending} aria-haspopup="menu" aria-expanded={open} className={className} data-testid={testId}>
        {label}
      </RowButton>
      {open ? (
        <div role="menu" className={cn("absolute top-full z-20 mt-1 min-w-[230px] rounded-[10px] border border-border bg-white p-1.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.12)]", align === "right" ? "right-0" : "left-0")} data-testid="pass-menu">
          <div className="label-caps px-2.5 pt-1.5 pb-1">Pass because</div>
          {PASS_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="menuitem"
              className="block w-full rounded-md px-2.5 py-[7px] text-left text-[13px] text-slate-800 hover:bg-slate-100"
              onClick={() => {
                setOpen(false);
                onPick(r.value);
              }}
              data-testid={`pass-reason-${r.value}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/**
 * One listing to screen: name and the buy box pill, what it does, source, broker and location, the three figures,
 * Pass (reason menu) and Interested (soft blue), each figure in a fixed column. After either the row shows one line, then leaves the list.
 * `hidden` keeps the row in the page but out of sight (the filter pills and Find on Screen listings).
 */
export function ListingRow({ listing, hidden = false }: { listing: ListingRowData; hidden?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "blue"; text: string } | null>(null);
  const refresh = () => setTimeout(() => router.refresh(), 1500);

  const pass = (reason: PassReason) =>
    start(async () => {
      const r = await passDeal(listing.id, reason);
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setResult({ tone: "blue", text: `${listing.name} passed: ${(PASS_REASONS.find((x) => x.value === reason)?.label ?? reason).toLowerCase()}. Kept in the Passed list.` });
      refresh();
    });
  const interested = () =>
    start(async () => {
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
      right={
        <>
          <Stat value={moneyShort(listing.revenue)} label="Revenue" testId="listing-revenue-stat" />
          <Stat value={listing.earnings === null ? "Not stated" : moneyShort(listing.earnings)} label={listing.earningsLabel ?? "EBITDA"} testId="listing-earnings-stat" />
          <Stat value={moneyShort(listing.askingPrice)} label="Asking" testId="listing-asking-stat" />
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
        <Name>{listing.name}</Name>
        <Pill tone={listing.buyBox.fits ? "green" : "amber"} testId="buy-box-pill">
          {listing.buyBox.label}
        </Pill>
      </Line1>
      {listing.whatItDoes ? <Line2>{listing.whatItDoes}</Line2> : null}
      {meta ? <Line3>{meta}</Line3> : null}
    </RowShell>
  );
}
