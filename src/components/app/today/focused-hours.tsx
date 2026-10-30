"use client";

import { useState, useTransition } from "react";
import { saveFocusedHours } from "@/app/actions/today";
import { focusedHoursText, parseFocusedHours } from "@/lib/calc/today";
import { cn } from "@/lib/utils";

/** "Focused hours today: [ 4 ]": one small field under the Today heading, saved when it loses focus. */
export function FocusedHours({ hours, locked }: { hours: number | null; locked: boolean }) {
  const [value, setValue] = useState(focusedHoursText(hours));
  const [saved, setSaved] = useState<string>(focusedHoursText(hours));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    const clean = focusedHoursText(parseFocusedHours(value));
    setValue(clean);
    if (clean === saved) return;
    start(async () => {
      const r = await saveFocusedHours(clean);
      if (!r.ok) return setError(r.error);
      setError(null);
      setSaved(focusedHoursText(r.hours));
    });
  };
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700" data-testid="focused-hours">
      Focused hours today:
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        disabled={locked}
        aria-label="Focused hours today"
        className={cn("tabular h-7 w-14 rounded-md border border-input bg-background px-2 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", pending && "opacity-60")}
        data-testid="focused-hours-input"
      />
      {error ? <span className="text-xs text-status-missed">{error}</span> : null}
    </label>
  );
}
