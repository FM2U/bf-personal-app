"use client";

/**
 * Resolve a missed commitment (`?w=resolve/<miss id>`, a medium window over the page it was opened from): the
 * commitment and the miss, a one-line reason, then a new date or a decision record. Opened from the Resolve button on
 * Commitments, the task window's list of misses, Home alerts, and older `/accountability?miss=<id>` links.
 * After a new date the window closes with "New date saved"; after Open a decision it shows the new decision.
 */
import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { flashMessage, useWindowNav } from "@/components/app/window-host";
import { ActionError, clearWindowCache, ErrorView, LoadingView, useLoad, ViewLayout } from "@/components/app/windows/views";
import { loadResolveWindow, type ResolveWindowData } from "@/app/actions/window";
import { resolveMiss } from "@/app/actions/records";
import { recordHref } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Result = Awaited<ReturnType<typeof resolveMiss>>;

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="clamp-1 text-xs font-medium text-slate-500">{label}</dt>
      <dd className={cn("tabular mt-0.5 text-sm", className)}>{children}</dd>
    </div>
  );
}

export function ResolveWindow({ missId }: { missId: string }) {
  const nav = useWindowNav();
  const { data } = useLoad<ResolveWindowData>(`resolve:${missId}`, () => loadResolveWindow(missId));
  const [mode, setMode] = useState<"new_date" | "decision">("new_date");
  const [error, setError] = useState<string | null>(null);
  if (!data) return <LoadingView />;
  if (!data.ok) return <ErrorView error={data.error} href="/accountability" />;
  const { miss: m, commitment: c, today } = data;
  const commitmentHref = recordHref(c.recordType, c.recordId);
  const pending = m.resolution === "pending";

  const done = (r: Result) => {
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    clearWindowCache();
    nav.refreshPage();
    if (r.resolution === "decision" && r.decisionId) {
      flashMessage("Decision opened. Choose one of its options when you are ready.");
      nav.replace({ kind: "record", table: "decisions", id: r.decisionId });
    } else {
      flashMessage("Reason and new date saved.");
      nav.close();
    }
  };

  return (
    <ViewLayout
      title="Resolve missed commitment"
      subtitle={c.title}
      askLabel={`Missed commitment: ${c.title}`}
      footer={
        <Link href={commitmentHref} className="text-sm font-medium text-primary-strong hover:underline" data-testid="resolve-open-commitment">
          Open the {c.type.toLowerCase()}
        </Link>
      }
    >
      <div className="flex max-w-[44rem] flex-col gap-5" data-testid="resolve-window">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-4">
          <Fact label="Type">{c.type}</Fact>
          <Fact label="Was due">{fmtDate(m.missedOn)}</Fact>
          <Fact label="Times missed" className={c.missCount ? "font-medium text-status-missed" : ""}>
            {c.missCount}
          </Fact>
          <Fact label="Status">
            <StatusBadge status={pending ? "missed" : "neutral"}>{pending ? "Reason needed" : "Resolved"}</StatusBadge>
          </Fact>
        </dl>
        {pending ? (
          <GuardedForm
            action={async (fd) => {
              try {
                return await resolveMiss(fd);
              } catch {
                return { ok: false as const, error: "Not saved. Try again." };
              }
            }}
            onResult={(r) => done(r as Result)}
            className="flex flex-col gap-4"
            data-testid="resolve-form"
          >
            <input type="hidden" name="miss_id" value={m.id} />
            <FormField label="Why was it missed?" htmlFor="resolve-reason" required hint="One line. It is shown in reviews and partner reports.">
              <Input id="resolve-reason" name="reason" defaultValue={m.reason ?? ""} placeholder="Example: the broker moved the call to next week" required maxLength={200} autoFocus />
            </FormField>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-800">What happens next</legend>
              <label className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm", mode === "new_date" ? "border-primary-border bg-primary-soft" : "border-slate-200")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="resolution" value="new_date" checked={mode === "new_date"} onChange={() => setMode("new_date")} className="accent-primary" data-testid="resolve-new-date" />
                  <span className="font-medium">Set a new date</span>
                </span>
                <Input name="new_due_date" type="date" className="w-44" aria-label="New due date" defaultValue={today} min={today} disabled={mode !== "new_date"} required={mode === "new_date"} />
                <span className="basis-full text-xs text-muted-foreground">The commitment is open again with this due date.</span>
              </label>
              <label className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm", mode === "decision" ? "border-primary-border bg-primary-soft" : "border-slate-200")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="resolution" value="decision" checked={mode === "decision"} onChange={() => setMode("decision")} className="accent-primary" data-testid="resolve-decision" />
                  <span className="font-medium">Open a decision</span>
                </span>
                <span className="basis-full text-xs text-muted-foreground">Creates a decision record with three options: set a new date, change the commitment, or drop it.</span>
              </label>
            </fieldset>
            <ActionError error={error} />
            <div>
              <SubmitButton size="sm" data-testid="resolve-save">
                Save
              </SubmitButton>
            </div>
          </GuardedForm>
        ) : (
          <p className="text-sm text-slate-700">
            This miss is already resolved{m.reason ? `. Reason: ${m.reason}` : ""}.{" "}
            {m.resolution === "new_date" && m.newDue ? `New date: ${fmtDate(m.newDue)}.` : m.resolution === "decision" ? "A decision was opened." : ""}
          </p>
        )}
      </div>
    </ViewLayout>
  );
}
