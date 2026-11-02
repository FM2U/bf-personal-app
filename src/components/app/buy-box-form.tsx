"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBuyBoxSettings, type BuyBoxInput } from "@/app/actions/buy-box";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { RowButton } from "@/components/app/work/ui";
import { BUY_BOX_FINANCING_MAX, BUY_BOX_GROWTH_MAX } from "@/lib/work/buy-box";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";

/**
 * The three Buy box settings (AI instructions, 2026-11-02): Owner-operator as two buttons (Yes, No), Financing and
 * Growth goals as one-line boxes. Save keeps all three and shows "Saved"; typed text stays on an error.
 */
export function BuyBoxForm({ initial }: { initial: BuyBoxInput }) {
  const ids = useId();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [ownerOperator, setOwnerOperator] = useState(initial.ownerOperator);
  const [financing, setFinancing] = useState(initial.financing);
  const [growthGoals, setGrowthGoals] = useState(initial.growthGoals);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = ownerOperator !== saved.ownerOperator || financing.trim() !== saved.financing.trim() || growthGoals.trim() !== saved.growthGoals.trim();
  useUnsavedWork(dirty, "The buy box is not saved yet.");
  const save = () =>
    start(async () => {
      setNote(null);
      const input = { ownerOperator, financing, growthGoals };
      const r = await saveBuyBoxSettings(input);
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setSaved({ ownerOperator, financing: financing.trim(), growthGoals: growthGoals.trim() });
      setNote({ ok: true, text: "Saved" });
      router.refresh();
    });
  const choice = (value: boolean, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={ownerOperator === value}
      onClick={() => setOwnerOperator(value)}
      className={cn("h-9 min-w-[72px] rounded-[7px] border px-3.5 text-[13px] font-medium", ownerOperator === value ? "border-primary bg-primary-soft text-primary-strong" : "border-input bg-white text-slate-700 hover:bg-slate-50")}
      data-testid={`buy-box-owner-${value ? "yes" : "no"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-1 items-center gap-x-3.5 gap-y-3 sm:grid-cols-[120px_minmax(0,1fr)]" data-testid="buy-box-form">
      <span className={LABEL} id={`${ids}-o`}>
        Owner-operator
      </span>
      <div className="flex gap-2" role="radiogroup" aria-labelledby={`${ids}-o`}>
        {choice(true, "Yes")}
        {choice(false, "No")}
      </div>
      <label htmlFor={`${ids}-f`} className={LABEL}>
        Financing
      </label>
      <input id={`${ids}-f`} value={financing} onChange={(e) => setFinancing(e.target.value)} maxLength={BUY_BOX_FINANCING_MAX} placeholder="Optional, for example SBA loan and seller note" className={INPUT} data-testid="buy-box-financing" />
      <label htmlFor={`${ids}-g`} className={LABEL}>
        Growth goals
      </label>
      <input id={`${ids}-g`} value={growthGoals} onChange={(e) => setGrowthGoals(e.target.value)} maxLength={BUY_BOX_GROWTH_MAX} placeholder="Optional, one line" className={INPUT} data-testid="buy-box-growth" />
      <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
        {note && !dirty ? (
          <span className={cn("text-[13px]", note.ok ? "font-medium text-status-met" : "text-status-missed")} role="status" data-testid="buy-box-note">
            {note.text}
          </span>
        ) : null}
        {note && !note.ok && dirty ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="buy-box-note">
            {note.text}
          </span>
        ) : null}
        <RowButton tone="primary" onClick={save} disabled={pending || !dirty} data-testid="buy-box-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
    </div>
  );
}
