"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveBuyBoxSettings, type BuyBoxInput } from "@/app/actions/buy-box";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { RowButton } from "@/components/app/work/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BASE_BUY_BOX_PREFERENCE, buyBoxLine } from "@/lib/ai/instructions";
import { BUY_BOX_TEXT_MAX, EXCLUDED_TYPES, US_REGIONS, amountWords, buyBoxRangeProblem, oneLine, parseMoneyText, type BuyBoxSettings, type ExcludedKey, type RegionKey } from "@/lib/work/buy-box";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";
/** Label column and field column: every row of both cards lines up, labels kept to one line. */
const GRID = "grid grid-cols-1 items-start gap-x-3.5 gap-y-3 sm:grid-cols-[112px_minmax(0,1fr)]";
const ROW_LABEL = cn(LABEL, "whitespace-nowrap sm:pt-2.5");

/** The form's values: the amounts as typed, the lists, and the texts. */
function formOf(b: BuyBoxSettings): BuyBoxInput {
  return {
    coreMin: amountWords(b.coreMin),
    coreMax: amountWords(b.coreMax),
    stretchMin: amountWords(b.stretchMin),
    stretchMax: amountWords(b.stretchMax),
    industries: b.industries,
    excluded: [...b.excluded],
    excludedOther: b.excludedOther ?? "",
    regions: [...b.regions],
    regionsOther: b.regionsOther ?? "",
    ownerOperator: b.ownerOperator,
  };
}

/** The settings a form describes (amounts read from the typed text; NaN when not a number). */
function settingsOf(f: BuyBoxInput): BuyBoxSettings {
  return {
    coreMin: parseMoneyText(f.coreMin) ?? NaN,
    coreMax: parseMoneyText(f.coreMax) ?? NaN,
    stretchMin: parseMoneyText(f.stretchMin) ?? NaN,
    stretchMax: parseMoneyText(f.stretchMax) ?? NaN,
    industries: oneLine(f.industries, BUY_BOX_TEXT_MAX) ?? "",
    excluded: EXCLUDED_TYPES.filter((e) => f.excluded.includes(e.key)).map((e) => e.key),
    excludedOther: oneLine(f.excludedOther, BUY_BOX_TEXT_MAX),
    regions: US_REGIONS.filter((r) => f.regions.includes(r.key)).map((r) => r.key),
    regionsOther: oneLine(f.regionsOther, BUY_BOX_TEXT_MAX),
    ownerOperator: f.ownerOperator,
  };
}

const sameSettings = (a: BuyBoxSettings, b: BuyBoxSettings) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Buy box form (AI instructions revision 1): two cards side by side on wider screens. "Size and owner": the core
 * range and the stretch range (amounts typed as $1M, 750K), owner-operator (Yes, No), and "What the AI reads" (the saved
 * buy box as the instructions name it). "Industries and regions": industries included, excluded types (three boxes and
 * Other), regions (five boxes and Other). One Save under both keeps everything and shows "Saved"; what was typed stays
 * on an error. Leaving with a change not saved asks first.
 */
export function BuyBoxForm({ initial }: { initial: BuyBoxSettings }) {
  const ids = useId();
  const router = useRouter();
  const [saved, setSaved] = useState<BuyBoxSettings>(initial);
  const [f, setF] = useState<BuyBoxInput>(() => formOf(initial));
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const current = settingsOf(f);
  const dirty = !sameSettings(current, saved);
  useUnsavedWork(dirty, "The buy box is not saved yet.");
  const set = <K extends keyof BuyBoxInput>(k: K, v: BuyBoxInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = <T extends string>(list: T[], key: T): T[] => (list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  const save = () =>
    start(async () => {
      setNote(null);
      const problem = buyBoxRangeProblem(current);
      if (problem) return setNote({ ok: false, text: problem });
      const r = await saveBuyBoxSettings(f);
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setSaved(current);
      setF(formOf(current));
      setNote({ ok: true, text: "Saved" });
      router.refresh();
    });
  const amount = (k: "coreMin" | "coreMax" | "stretchMin" | "stretchMax", label: string) => (
    <input value={f[k]} onChange={(e) => set(k, e.target.value)} aria-label={label} inputMode="decimal" className={cn(INPUT, "w-[104px] tabular-nums")} data-testid={`buy-box-${k === "coreMin" ? "core-min" : k === "coreMax" ? "core-max" : k === "stretchMin" ? "stretch-min" : "stretch-max"}`} />
  );
  const range = (from: "coreMin" | "stretchMin", to: "coreMax" | "stretchMax", name: string) => (
    <div className="flex flex-wrap items-center gap-2">
      {amount(from, `${name} from`)}
      <span className="text-[13px] text-muted-foreground">to</span>
      {amount(to, `${name} to`)}
    </div>
  );
  const box = (checked: boolean, onChange: () => void, label: string, testId: string) => (
    <label className="inline-flex h-8 items-center gap-2 text-[13px] text-slate-800" data-testid={`${testId}-label`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 rounded border-input accent-[#14297b]" data-testid={testId} />
      {label}
    </label>
  );
  const ownerChoice = (value: boolean, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={f.ownerOperator === value}
      onClick={() => set("ownerOperator", value)}
      className={cn("h-9 min-w-[72px] rounded-[7px] border px-3.5 text-[13px] font-medium", f.ownerOperator === value ? "border-primary bg-primary-soft text-primary-strong" : "border-input bg-white text-slate-700 hover:bg-slate-50")}
      data-testid={`buy-box-owner-${value ? "yes" : "no"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2" data-testid="buy-box-form">
      <Card>
        <CardHeader>
          <CardTitle>Size and owner</CardTitle>
          <CardDescription>
            Yearly EBITDA, or SDE when there is no EBITDA. On <Link href="/work/listings" className="underline">Screen listings</Link>, inside the core range is Fits; inside the stretch range but outside the core is Near fit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className={GRID}>
            <span className={ROW_LABEL}>Core range</span>
            {range("coreMin", "coreMax", "Core range")}
            <span className={ROW_LABEL}>Stretch range</span>
            {range("stretchMin", "stretchMax", "Stretch range")}
            <span className={ROW_LABEL} id={`${ids}-o`}>
              Owner-operator
            </span>
            <div className="flex gap-2" role="radiogroup" aria-labelledby={`${ids}-o`}>
              {ownerChoice(true, "Yes")}
              {ownerChoice(false, "No")}
            </div>
          </div>
          <div className="rounded-lg border border-violet-rule bg-violet-soft px-3.5 py-2.5" data-testid="buy-box-line">
            <span className="block text-xs font-medium text-muted-foreground">What the AI reads</span>
            <p className="mt-1 text-[13px] text-slate-800">
              {buyBoxLine(saved)} {BASE_BUY_BOX_PREFERENCE}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Industries and regions</CardTitle>
          <CardDescription>An excluded type makes a listing Outside. A region outside the list makes it a Near fit when everything else fits.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={GRID}>
            <label htmlFor={`${ids}-i`} className={ROW_LABEL}>
              Industries
            </label>
            <input id={`${ids}-i`} value={f.industries} onChange={(e) => set("industries", e.target.value)} maxLength={BUY_BOX_TEXT_MAX} placeholder="Any industry" className={INPUT} data-testid="buy-box-industries" />
            <span className={ROW_LABEL}>Excluded</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap gap-x-4">
                {EXCLUDED_TYPES.map((e) => (
                  <span key={e.key}>{box(f.excluded.includes(e.key), () => set("excluded", toggle<ExcludedKey>(f.excluded, e.key)), e.label, `buy-box-excluded-${e.key}`)}</span>
                ))}
              </div>
              <input value={f.excludedOther} onChange={(e) => set("excludedOther", e.target.value)} maxLength={BUY_BOX_TEXT_MAX} aria-label="Other excluded types" placeholder="Other types, with commas" className={INPUT} data-testid="buy-box-excluded-other" />
            </div>
            <span className={ROW_LABEL}>Regions</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap gap-x-4">
                {US_REGIONS.map((r) => (
                  <span key={r.key}>{box(f.regions.includes(r.key), () => set("regions", toggle<RegionKey>(f.regions, r.key)), r.label, `buy-box-region-${r.key}`)}</span>
                ))}
              </div>
              <input value={f.regionsOther} onChange={(e) => set("regionsOther", e.target.value)} maxLength={BUY_BOX_TEXT_MAX} aria-label="Other regions" placeholder="Other states or places, with commas" className={INPUT} data-testid="buy-box-regions-other" />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-2">
        {note ? (
          <span className={cn("text-[13px]", note.ok ? "font-medium text-status-met" : "text-status-missed")} role={note.ok ? "status" : "alert"} data-testid="buy-box-note">
            {note.ok && dirty ? "" : note.text}
          </span>
        ) : null}
        <RowButton tone="primary" onClick={save} disabled={pending || !dirty} data-testid="buy-box-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
    </div>
  );
}
