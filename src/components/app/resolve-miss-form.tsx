"use client";

/**
 * The one form that resolves a missed commitment: "Why was it missed?" (one line, required for every choice), then
 * Done late (the date it was done, today by default, not before the due date, not in the future, and an optional
 * note), New date, Open a decision, or No longer a commitment. Used by the task window ("Resolve this miss",
 * src/components/app/windows/task-window.tsx) and by step 2 of Close the day (src/components/app/close/changes-step.tsx).
 * The caller decides what happens after a save (close the window, refresh the list).
 */
import { useState } from "react";
import { Input, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ActionError } from "@/components/app/windows/views";
import { resolveMiss } from "@/app/actions/records";
import { defaultDoneOn, RESOLVE_CHOICES, type MissResolution } from "@/lib/calc/resolve-miss";
import { DB_UPDATE_NOTICE_0018 } from "@/lib/schema-guard";
import { cn } from "@/lib/utils";

export type ResolveResult = Awaited<ReturnType<typeof resolveMiss>>;

export function ResolveMissForm({
  missId,
  due,
  today,
  has0018,
  reason,
  onDone,
  autoFocus = true,
  compact = false,
}: {
  missId: string;
  /** The date the commitment was due (the earliest "Done late" date). */
  due: string;
  today: string;
  /** Database update 0018 is applied (Done late can be saved). */
  has0018: boolean;
  /** A reason already given (for example in the daily close). */
  reason?: string | null;
  onDone: (r: ResolveResult) => void;
  autoFocus?: boolean;
  /** Smaller spacing (inside a list row). */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<MissResolution>("done_late");
  const [error, setError] = useState<string | null>(null);
  return (
    <GuardedForm
      action={async (fd) => {
        try {
          return await resolveMiss(fd);
        } catch {
          return { ok: false as const, error: "Not saved. Try again." };
        }
      }}
      onResult={(r) => {
        const res = r as ResolveResult;
        if (!res.ok) return setError(res.error);
        setError(null);
        onDone(res);
      }}
      className={cn("flex flex-col", compact ? "gap-3" : "gap-4")}
      data-testid="resolve-form"
    >
      <input type="hidden" name="miss_id" value={missId} />
      <FormField label="Why was it missed?" htmlFor={`resolve-reason-${missId}`} required hint="One line. It is shown in reviews and partner reports.">
        <Input id={`resolve-reason-${missId}`} name="reason" defaultValue={reason ?? ""} placeholder="Example: the broker moved the call to next week" required maxLength={200} autoFocus={autoFocus} />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-800">What happens next</legend>
        {RESOLVE_CHOICES.map((choice) => {
          const on = mode === choice.value;
          const blocked = choice.value === "done_late" && !has0018;
          return (
            <label key={choice.value} className={cn("grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 rounded-lg border p-3 text-sm", on ? "border-primary-border bg-primary-soft" : "border-slate-200")}>
              <input type="radio" name="resolution" value={choice.value} checked={on} onChange={() => setMode(choice.value)} className="mt-0.5 accent-primary" data-testid={`resolve-${choice.value.replace("_", "-")}`} />
              <span className="min-w-0">
                <span className="font-medium">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">{choice.help}</span>
              </span>
              {on && choice.value === "done_late" ? (
                <span className="col-start-2 flex flex-col gap-2">
                  {blocked ? (
                    <span className="text-xs font-medium text-status-soon">{DB_UPDATE_NOTICE_0018}</span>
                  ) : (
                    <>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-700">Date it was done</span>
                        <Input name="done_on" type="date" className="w-44" aria-label="Date it was done" defaultValue={defaultDoneOn(due, today)} min={due} max={today} required data-testid="resolve-done-on" />
                      </span>
                      <Textarea name="note" rows={2} maxLength={500} placeholder="Note (optional). Example: sent the LOI a day late, after the broker's call" aria-label="Note (optional)" data-testid="resolve-note" />
                    </>
                  )}
                </span>
              ) : null}
              {on && choice.value === "new_date" ? (
                <span className="col-start-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-700">New due date</span>
                  <Input name="new_due_date" type="date" className="w-44" aria-label="New due date" defaultValue={today} min={today} required />
                </span>
              ) : null}
            </label>
          );
        })}
      </fieldset>
      <ActionError error={error} />
      <div>
        <SubmitButton size="sm" data-testid="resolve-save" disabled={mode === "done_late" && !has0018}>
          Save
        </SubmitButton>
      </div>
    </GuardedForm>
  );
}
