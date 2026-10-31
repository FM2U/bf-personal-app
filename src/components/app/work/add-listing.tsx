"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createListing, fillListingFromText } from "@/app/actions/work";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { LISTING_SOURCES } from "@/lib/work/buy-box";
import { EMPTY_LISTING_FIELDS, LISTING_TEXT_MAX, type ListingFields } from "@/lib/work/listing-text";
import { RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";

/**
 * "Add a listing" (Screen listings): the header button opens the form card (?add=1). "Paste listing text" at the top
 * and "Fill from text" sends the text to the AI, which fills the fields; the owner corrects and presses Save to the
 * list. Typed text is never lost: a failed save shows its message under the buttons with everything still in place.
 */
export function AddListingButton({ open }: { open: boolean }) {
  return (
    <Link
      href={open ? "/work/listings" : "/work/listings?add=1"}
      className={cn("inline-flex h-9 items-center rounded-[7px] border px-3.5 text-[13px] font-medium", open ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary bg-primary text-white hover:bg-primary-hover")}
      data-testid="add-listing-button"
    >
      {open ? "Close the form" : "Add a listing"}
    </Link>
  );
}

export function AddListingCard() {
  const router = useRouter();
  const ids = useId();
  const open = true;
  const [text, setText] = useState("");
  const [f, setF] = useState<ListingFields>(EMPTY_LISTING_FIELDS);
  const [filling, startFill] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = open && (text.trim() !== "" || Object.entries(f).some(([k, v]) => k !== "source" && String(v).trim() !== ""));
  useUnsavedWork(dirty, "This listing is not saved yet. Leaving discards it.");

  const set = (k: keyof ListingFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  function fill() {
    setError(null);
    startFill(async () => {
      const r = await fillListingFromText(text);
      if (!r.ok) return setError(r.error);
      // Fields the owner already typed are kept; empty ones are filled.
      setF((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v).trim() && k !== "source" ? v : r.fields[k as keyof ListingFields] || v])) as ListingFields);
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const r = await createListing(f);
      if (!r.ok) return setError(r.error);
      const name = f.name;
      setF(EMPTY_LISTING_FIELDS);
      setText("");
      router.push(`/work/listings?saved=${encodeURIComponent(name)}`);
      router.refresh();
    });
  }

  return (
    <>
      {open ? (
        <WorkCard title="Add a listing" hint="Paste the broker email or page text and the AI fills the fields" testId="add-listing-card" className="mb-5">
          <div className="grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)] lg:grid-cols-[120px_minmax(0,1fr)_120px_minmax(0,1fr)]" data-testid="add-listing-form">
            <label htmlFor={`${ids}-text`} className={cn(LABEL, "sm:col-span-2 lg:col-span-4")}>
              Paste listing text
            </label>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4">
              <textarea id={`${ids}-text`} value={text} onChange={(e) => setText(e.target.value.slice(0, LISTING_TEXT_MAX))} rows={4} placeholder="Paste the email or the page here" className={cn(INPUT, "h-auto min-h-[72px] resize-y py-2")} data-testid="listing-text" />
              <div className="flex items-center gap-3">
                <RowButton onClick={fill} disabled={filling || text.trim().length < 20} data-testid="listing-fill">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {filling ? "Reading..." : "Fill from text"}
                </RowButton>
                <span className="text-xs text-muted-foreground">The AI fills the empty fields below. Check them, then save.</span>
              </div>
            </div>
            <Field id={`${ids}-name`} label="Name">
              <input id={`${ids}-name`} value={f.name} onChange={set("name")} className={INPUT} data-testid="listing-name" />
            </Field>
            <Field id={`${ids}-source`} label="Source">
              <select id={`${ids}-source`} value={f.source} onChange={set("source")} className={INPUT} data-testid="listing-source">
                {LISTING_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${ids}-what`} label="What it does">
              <input id={`${ids}-what`} value={f.what_it_does} onChange={set("what_it_does")} placeholder="The product or service and who buys it" className={INPUT} data-testid="listing-what" />
            </Field>
            <Field id={`${ids}-broker`} label="Broker">
              <input id={`${ids}-broker`} value={f.broker_name} onChange={set("broker_name")} placeholder="Firm, person" className={INPUT} data-testid="listing-broker" />
            </Field>
            <Field id={`${ids}-rev`} label="Revenue">
              <input id={`${ids}-rev`} value={f.revenue} onChange={set("revenue")} placeholder="$4.1M" className={INPUT} data-testid="listing-revenue" />
            </Field>
            <Field id={`${ids}-earn`} label="EBITDA or SDE">
              <input id={`${ids}-earn`} value={f.earnings} onChange={set("earnings")} placeholder="$1.2M, or $1.2M SDE" className={INPUT} data-testid="listing-earnings" />
            </Field>
            <Field id={`${ids}-ask`} label="Asking price">
              <input id={`${ids}-ask`} value={f.asking_price} onChange={set("asking_price")} placeholder="$3.9M" className={INPUT} data-testid="listing-asking" />
            </Field>
            <Field id={`${ids}-loc`} label="Location">
              <input id={`${ids}-loc`} value={f.location} onChange={set("location")} placeholder="City, ST" className={INPUT} data-testid="listing-location" />
            </Field>
            <Field id={`${ids}-ind`} label="Industry">
              <input id={`${ids}-ind`} value={f.industry} onChange={set("industry")} placeholder="Commercial services" className={INPUT} data-testid="listing-industry" />
            </Field>
            <Field id={`${ids}-link`} label="Link">
              <input id={`${ids}-link`} value={f.listing_url} onChange={set("listing_url")} placeholder="https://" className={INPUT} data-testid="listing-link" />
            </Field>
            {error ? (
              <p className="rounded-md bg-status-missed-bg px-3 py-2 text-[13px] text-status-missed sm:col-span-2 lg:col-span-4" role="alert" data-testid="listing-error">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
              <RowButton onClick={() => router.push("/work/listings")} disabled={saving}>
                Cancel
              </RowButton>
              <RowButton tone="primary" onClick={save} disabled={saving || !f.name.trim()} data-testid="listing-save">
                {saving ? "Saving..." : "Save to the list"}
              </RowButton>
            </div>
          </div>
        </WorkCard>
      ) : null}
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
    </>
  );
}
