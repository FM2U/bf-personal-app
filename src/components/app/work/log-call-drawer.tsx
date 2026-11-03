"use client";

import { useId, useState, useTransition } from "react";
import { logCall } from "@/app/actions/outreach";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import { nextDateChoices } from "@/lib/work/outreach";
import { Drawer } from "@/components/app/work/drawer";
import { RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Log a call (batch B, approved 2026-10-31): a right-side drawer usable from a person (Outreach row, the person
 * page, the Home tile) and from a deal page. Who (prefilled), date and time (now), length in minutes, what was
 * said, then the outcome: the next action (on a person, what the next follow-up is for) and the next follow-up
 * date. Save writes one communication of kind call on the record's timeline; the person's last contact and the
 * Outreach row move with it, and the weekly counter counts it.
 */
export type LogCallTarget = {
  contactId: string | null;
  dealId: string | null;
  who: string;
  /** The quiet line under the title: "From Outreach", "From Mark Reed's page", "From Dalton Services". */
  from: string;
  /** The person's or deal's current next date (shown in "Keep the current date"). */
  currentDate: string | null;
  /** Push B: a call logged from an organization's page (the person named is looked up among its people). */
  organizationId?: string | null;
};

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-600";
const LABEL = "text-[13px] font-medium text-slate-700";
const LENGTHS = [10, 15, 20, 30, 45, 60];

/** Now in the owner's time zone as a datetime-local value ("2026-11-03T10:40"), whatever the browser's clock zone. */
function nowLocal(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

export function LogCallDrawer({ target, today, tz, open, onOpenChange, onSaved }: { target: LogCallTarget; today: string; /** The owner's time zone (the date and time default to now there). */ tz: string; open: boolean; onOpenChange: (open: boolean) => void; /** Called after the save with what to say on the row ("Call logged, 20 min"). */ onSaved?: (r: { minutes: number; nextDate: string | null | "keep"; nextAction: string | null }) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Log a call" sub={target.from} testId="log-call-drawer">
      {/* The form mounts fresh each time the drawer opens (the drawer's content unmounts when closed), so every field starts clean. */}
      <CallForm target={target} today={today} tz={tz} onOpenChange={onOpenChange} onSaved={onSaved} />
    </Drawer>
  );
}

function CallForm({ target, today, tz, onOpenChange, onSaved }: { target: LogCallTarget; today: string; tz: string; onOpenChange: (open: boolean) => void; onSaved?: (r: { minutes: number; nextDate: string | null | "keep"; nextAction: string | null }) => void }) {
  const ids = useId();
  const [who, setWho] = useState(target.who);
  const [when, setWhen] = useState(() => nowLocal(tz));
  const [minutes, setMinutes] = useState("20");
  const [said, setSaid] = useState("");
  const [next, setNext] = useState("");
  const [nextDate, setNextDate] = useState("keep");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = said.trim() !== "" || next.trim() !== "";
  useUnsavedWork(dirty, "The call is not logged yet.");
  const choices = nextDateChoices(today);
  const person = !!target.contactId && !target.dealId;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await logCall({ contactId: target.contactId, dealId: target.dealId, organizationId: target.organizationId ?? null, who, when, minutes, said, nextAction: next, nextDate });
      if (!r.ok) return setError(r.error);
      onOpenChange(false);
      onSaved?.({ minutes: Number(minutes) || 0, nextDate: nextDate === "keep" ? "keep" : nextDate === "none" ? null : nextDate, nextAction: next.trim() || null });
    });
  return (
    <>
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[118px_minmax(0,1fr)]" data-testid="log-call-form">
        <label htmlFor={`${ids}-who`} className={LABEL}>
          Who
        </label>
        <input id={`${ids}-who`} value={who} onChange={(e) => setWho(e.target.value)} disabled={!!target.contactId} className={INPUT} placeholder="Who you spoke with" data-testid="call-who" />
        <label htmlFor={`${ids}-when`} className={LABEL}>
          Date and time
        </label>
        <input id={`${ids}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={INPUT} data-testid="call-when" />
        <label htmlFor={`${ids}-len`} className={LABEL}>
          Length
        </label>
        <select id={`${ids}-len`} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={INPUT} data-testid="call-minutes">
          {LENGTHS.map((n) => (
            <option key={n} value={String(n)}>
              {n} min
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-said`} className={cn(LABEL, "sm:self-start sm:pt-2")}>
          What was said
        </label>
        <textarea id={`${ids}-said`} value={said} onChange={(e) => setSaid(e.target.value)} rows={3} placeholder="Two or three lines are enough" className={cn(INPUT, "h-auto min-h-[76px] py-2 leading-[22px]")} data-testid="call-said" />
        <div className="label-caps mt-2 border-b border-border pb-[7px] sm:col-span-2">Outcome</div>
        <label htmlFor={`${ids}-next`} className={LABEL}>
          {person ? "Next follow-up for" : "Next action"}
        </label>
        <input id={`${ids}-next`} value={next} onChange={(e) => setNext(e.target.value)} placeholder={person ? "What the next follow-up is for" : "What you do next"} className={INPUT} data-testid="call-next" />
        <label htmlFor={`${ids}-date`} className={LABEL}>
          {person ? "Next follow-up" : "Due"}
        </label>
        <select id={`${ids}-date`} value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={INPUT} data-testid="call-next-date">
          <option value="keep">{target.currentDate ? `Keep the current date (${fmtDate(target.currentDate, "MMM d")})` : person ? "Keep as it is (no date)" : "Keep the current date"}</option>
          {choices.map((c) => (
            <option key={c.date} value={c.date}>
              {c.label((d) => fmtDate(d, "MMM d"))}
            </option>
          ))}
          {person ? <option value="none">No date</option> : null}
        </select>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="call-error">
            {error}
          </span>
        ) : null}
        <RowButton onClick={() => onOpenChange(false)} className="h-9 px-3.5 text-[13px]" disabled={pending}>
          Cancel
        </RowButton>
        <RowButton tone="primary" onClick={save} className="h-9 px-3.5 text-[13px]" disabled={pending} data-testid="call-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
      <p className="mt-4 text-[12.5px] leading-5 text-muted-foreground">Saved calls appear on the timeline as a call entry and count toward the weekly outreach target when the person is on Contacts.</p>
    </>
  );
}
