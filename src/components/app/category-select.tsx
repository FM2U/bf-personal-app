"use client";

import { useState, useTransition } from "react";
import { setCategory } from "@/app/actions/finance";

/** Category picker on each transaction. A change can be saved as a rule for the merchant. */
export function CategorySelect({ transactionId, value, categories, source }: { transactionId: string; value: string | null; categories: { id: string; name: string; kind: string }[]; source: string }) {
  const [current, setCurrent] = useState(value ?? "");
  const [askRule, setAskRule] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (cat: string, rule: boolean) =>
    start(async () => {
      await setCategory(transactionId, cat || null, rule);
      setAskRule(null);
    });
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <select
        value={current}
        disabled={pending}
        aria-label="Category"
        onChange={(e) => {
          setCurrent(e.target.value);
          if (e.target.value) setAskRule(e.target.value);
          else save("", false);
        }}
        className={`h-8 w-full rounded-md border px-2 text-xs ${current ? "border-input bg-white" : "border-amber-300 bg-amber-50"}`}
      >
        <option value="">Uncategorized</option>
        {["expense", "income", "transfer"].map((k) => (
          <optgroup key={k} label={k === "expense" ? "Expenses" : k === "income" ? "Income" : "Transfers"}>
            {categories
              .filter((c) => c.kind === k)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {askRule ? (
        <span className="flex gap-2 text-[11px]">
          <button type="button" className="font-medium text-teal-800 underline" onClick={() => save(askRule, true)}>
            Save and make a rule
          </button>
          <button type="button" className="text-slate-600 underline" onClick={() => save(askRule, false)}>
            Only this one
          </button>
        </span>
      ) : source === "ai" ? (
        <span className="text-[11px] text-muted-foreground">Set by AI (approved)</span>
      ) : source === "rule" ? (
        <span className="text-[11px] text-muted-foreground">Set by a rule</span>
      ) : null}
    </div>
  );
}
