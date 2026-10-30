"use client";

/**
 * Close the day, step 2: "What changed in the plan?" (optional), "Tomorrow's top priority" (one line, required), and
 * the missed commitments that still need a reason (today's and earlier), each resolved right here with the same form
 * as the task window (src/components/app/resolve-miss-form.tsx). The two fields save when they lose focus; Next
 * saves them again and moves on.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ResolveMissForm } from "@/components/app/resolve-miss-form";
import { finishChangesStep, saveChangesStep } from "@/app/actions/today";
import { resolutionLabel } from "@/lib/calc/resolve-miss";
import { date as fmtDate } from "@/lib/format";
import type { PendingMiss } from "@/lib/today";
import { cn } from "@/lib/utils";

export function ChangesStep({ changes, tomorrow, misses, today, has0018 }: { changes: string; tomorrow: string; misses: PendingMiss[]; today: string; has0018: boolean }) {
  const router = useRouter();
  const [changesText, setChanges] = useState(changes);
  const [tomorrowText, setTomorrow] = useState(tomorrow);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveChangesStep({ changes: changesText, tomorrow: tomorrowText });
      setSaved(r.ok ? "Saved" : null);
      if (!r.ok) setError(r.error);
    });
  const next = () =>
    start(async () => {
      const r = await finishChangesStep({ changes: changesText, tomorrow: tomorrowText });
      // A redirect never returns; a returned value is a problem to show.
      if (r && !r.ok) setError(r.error);
    });
  const pendingCount = misses.filter((m) => m.resolution === "pending").length;
  return (
    <div className="flex flex-col gap-6" data-testid="close-changes">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
        What changed in the plan? <span className="text-xs font-normal text-muted-foreground">Optional</span>
        <Textarea value={changesText} onChange={(e) => setChanges(e.target.value)} onBlur={save} rows={3} maxLength={2000} placeholder="Example: the broker call moved to Monday, so the CIM review took its place." data-testid="close-changes-text" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
        Tomorrow&apos;s top priority <span className="text-xs font-normal text-muted-foreground">One line. It becomes a high-priority task due tomorrow.</span>
        <Input
          value={tomorrowText}
          onChange={(e) => {
            setTomorrow(e.target.value);
            if (e.target.value.trim()) setError(null);
          }}
          onBlur={save} maxLength={200} placeholder="Example: finish the Dalton model" required data-testid="close-tomorrow" />
      </label>
      <section className="flex flex-col gap-2" data-testid="close-misses">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          Missed commitments
          {pendingCount ? <span className="rounded-full bg-status-missed-bg px-2 text-xs font-medium text-status-missed">{pendingCount}</span> : null}
        </h3>
        {misses.length ? (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-border">
            {misses.map((m) => {
              const isOpen = open === m.id && m.resolution === "pending";
              return (
                <li key={m.id} className="px-3 py-2" data-testid="close-miss" data-resolution={m.resolution}>
                  <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2">
                    <AlertTriangle aria-hidden className={cn("h-4 w-4", m.resolution === "pending" ? "text-status-missed" : "text-slate-400")} />
                    <span className="min-w-0">
                      <span className="clamp-1 text-sm font-medium text-slate-900">{m.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        Missed {fmtDate(m.missedOn, "MMM d")}
                        {m.resolution !== "pending" ? `. ${resolutionLabel({ resolution: m.resolution, done_on: m.doneOn, new_due_date: m.newDue })}${m.reason ? `: ${m.reason}` : ""}` : ""}
                      </span>
                    </span>
                    {m.resolution === "pending" ? (
                      <Button type="button" size="sm" variant={isOpen ? "ghost" : "outline"} onClick={() => setOpen(isOpen ? null : m.id)} data-testid="close-miss-resolve">
                        {isOpen ? "Hide" : "Resolve"}
                      </Button>
                    ) : (
                      <span className="text-xs font-medium text-status-met">Resolved</span>
                    )}
                  </div>
                  {isOpen ? (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <ResolveMissForm
                        missId={m.id}
                        due={m.missedOn}
                        today={today}
                        has0018={has0018}
                        reason={m.reason}
                        autoFocus={false}
                        compact
                        onDone={() => {
                          setOpen(null);
                          router.refresh();
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="close-no-misses">
            No misses to resolve.
          </p>
        )}
      </section>
      {error ? (
        <p role="alert" className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed" data-testid="close-error">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{saved ?? ""}</span>
        <Button type="button" onClick={next} disabled={pending} data-testid="close-next">
          {pending ? "Saving..." : "Next"}
        </Button>
      </div>
    </div>
  );
}
