"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { calendarActivity, setActivityKept } from "@/app/actions/accountability";
import { logWork } from "@/app/actions/outreach";
import { ACTIVITY_LABEL, clock12, sortActivity, type ActivityRow } from "@/lib/accountability/activity";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { Drawer } from "@/components/app/work/drawer";
import { ListingsReviewedButton } from "@/components/app/work/listings-reviewed";
import { ROW_BUTTON_BASE, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Today's activity on End of day (Bram, 2026-11-16, release 3b): one list of the day from what the app recorded, the
 * work logged with "+ Log work", and the matching Google Calendar events (read after the page shows). Each row has
 * Drop (or Keep again); a dropped row is grayed and left out of the report built from this list (release 4: the tracks
 * "worked on today", their Today lines and the 4:00 pm drafts).
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";
const MINUTES = [15, 30, 45, 60, 90, 120, 180, 240];

export function TodaysActivityCard({ day, rows, dropped, targets, closed }: { day: string; rows: ActivityRow[]; dropped: string[]; targets: { id: string; name: string; track: string }[]; closed: boolean }) {
  const router = useRouter();
  const [cal, setCal] = useState<{ status: string; rows: ActivityRow[] } | null>(null);
  const [off, setOff] = useState<Set<string>>(() => new Set(dropped));
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, start] = useTransition();
  useEffect(() => {
    let live = true;
    calendarActivity(day)
      .then((r) => {
        // Release 4: when new calendar rows were saved with the day, the page's report and Today lines are read again
        // by the save itself (one page read, no reload).
        if (live) setCal(r.ok ? { status: r.status, rows: r.rows } : { status: "unavailable", rows: [] });
      })
      .catch(() => live && setCal({ status: "unavailable", rows: [] }));
    return () => {
      live = false;
    };
  }, [day]);
  const all = sortActivity([...rows, ...(cal?.rows ?? [])]);
  const kept = all.filter((r) => !off.has(r.id)).length;
  const toggle = (id: string) => {
    const keep = off.has(id);
    setOff((s) => {
      const n = new Set(s);
      if (keep) n.delete(id);
      else n.add(id);
      return n;
    });
    start(async () => {
      setError(null);
      // Release 4: the save reads the page's report and Today lines again (one page read, no reload); the list stays as it is.
      const row = all.find((x) => x.id === id);
      const r = await setActivityKept(day, id, keep, row ? (row.recordHref ?? row.href) : null);
      if (!r.ok) {
        setError(r.error);
        setOff((s) => {
          const n = new Set(s);
          if (keep) n.add(id);
          else n.delete(id);
          return n;
        });
      }
    });
  };
  return (
    <WorkCard
      id="eod-activity"
      title="Today's activity"
      count={kept || null}
      sub="What the app recorded, the work you logged, and your matching calendar. Drop anything that did not happen."
      actions={
        !closed ? (
          <span className="flex items-center gap-2">
            <ListingsReviewedButton day={day} className={cn(ROW_BUTTON_BASE, "border-input bg-white text-slate-800 hover:bg-slate-50")} />
            <RowButton onClick={() => setAdding(true)} data-testid="activity-add">
              + Log work
            </RowButton>
          </span>
        ) : undefined
      }
      testId="eod-activity"
    >
      <div className="px-[22px] pt-1 pb-3">
        {all.length ? (
          all.map((r) => {
            const isOff = off.has(r.id);
            return (
              <div key={r.id} className={cn("grid grid-cols-[82px_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-slate-100 py-2 first:border-t-0", isOff && "opacity-50")} data-testid="activity-row" data-id={r.id} data-kind={r.kind} data-off={isOff ? "1" : "0"}>
                <span className="pt-px">
                  <span className="inline-block rounded-full border border-border bg-slate-50 px-2 py-px text-[11.5px] font-medium text-slate-700">{ACTIVITY_LABEL[r.kind]}</span>
                </span>
                <span className="min-w-0 text-[13px] leading-[1.45] text-slate-900">
                  <span className={cn(isOff && "line-through")}>{r.text}</span>
                  {r.record || r.time ? (
                    <span className="block text-[12px] text-muted-foreground">
                      {[r.time ? clock12(r.time) : null, r.record].filter(Boolean).map((x, n) =>
                        n === 1 && r.href ? (
                          <Link key="r" href={r.href} className="hover:underline">
                            {r.time ? " · " : ""}
                            {x}
                          </Link>
                        ) : (
                          <span key={String(n)}>{n ? " · " : ""}{x}</span>
                        ),
                      )}
                    </span>
                  ) : null}
                </span>
                {!closed && r.kind === "reviewed" ? (
                  <ListingsReviewedButton day={day} className="pt-px text-[12.5px] font-medium text-primary-strong hover:underline" testId="activity-reviewed-change">
                    Change
                  </ListingsReviewedButton>
                ) : !closed ? (
                  <button type="button" onClick={() => toggle(r.id)} aria-label={`${isOff ? "Keep" : "Drop"} ${r.text}`} aria-pressed={isOff} className="pt-px text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="activity-toggle">
                    {isOff ? "Keep" : "Drop"}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })
        ) : (
          <p className="py-2 text-[13px] text-muted-foreground" data-testid="activity-empty">
            Nothing recorded yet today. Use + Log work for research, modeling or anything else you did.
          </p>
        )}
        <p className="pt-2 text-[12px] text-muted-foreground" aria-live="polite" data-testid="activity-calendar-note">
          {cal === null ? "Reading your calendar..." : cal.status === "ok" ? "Calendar events show when they match a contact or a deal, or when the app blocked the time." : cal.status === "reconnect" ? "Reconnect Google (Settings, Connections) to add your calendar here." : cal.status === "not_connected" ? "Connect Google (Settings, Connections) to add your calendar here." : "Your calendar could not be read just now."}
        </p>
        {error ? (
          <p className="pt-1 text-[13px] text-status-missed" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <Drawer open={adding} onOpenChange={setAdding} title="Log work" sub="Work no other entry records: research, modeling, a deal structure" testId="log-work-drawer">
        <LogWorkForm
          targets={targets}
          onDone={(saved) => {
            setAdding(false);
            if (saved) router.refresh();
          }}
        />
      </Drawer>
    </WorkCard>
  );
}

function LogWorkForm({ targets, onDone }: { targets: { id: string; name: string; track: string }[]; onDone: (saved: boolean) => void }) {
  const ids = useId();
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [about, setAbout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useUnsavedWork(text.trim() !== "", "The work is not logged yet.");
  const tracks = [...new Set(targets.map((t) => t.track))];
  const save = () =>
    start(async () => {
      setError(null);
      const r = await logWork({ text, minutes: minutes || null, dealId: about || null });
      if (!r.ok) return setError(r.error);
      setText("");
      onDone(true);
    });
  return (
    <>
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[118px_minmax(0,1fr)]" data-testid="log-work-form">
        <label htmlFor={`${ids}-text`} className={LABEL}>
          What you did
        </label>
        <input id={`${ids}-text`} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Moody: deal structure and the MSO fee" className={INPUT} data-testid="work-text" />
        <label htmlFor={`${ids}-min`} className={LABEL}>
          Time
        </label>
        <select id={`${ids}-min`} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={INPUT} data-testid="work-minutes">
          <option value="">Not timed</option>
          {MINUTES.map((m) => (
            <option key={m} value={String(m)}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-about`} className={LABEL}>
          About
        </label>
        <select id={`${ids}-about`} value={about} onChange={(e) => setAbout(e.target.value)} className={INPUT} data-testid="work-about">
          <option value="">No deal, job or lead</option>
          {tracks.map((t) => (
            <optgroup key={t} label={t}>
              {targets
                .filter((x) => x.track === t)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="work-error">
            {error}
          </span>
        ) : null}
        <RowButton onClick={() => onDone(false)} className="h-9 px-3.5 text-[13px]" disabled={pending}>
          Cancel
        </RowButton>
        <RowButton tone="primary" onClick={save} className="h-9 px-3.5 text-[13px]" disabled={pending} data-testid="work-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
      <p className="mt-4 text-[12.5px] leading-5 text-muted-foreground">Logged work shows in Today&apos;s activity and on the deal&apos;s timeline. It never counts as a call, an email or outreach.</p>
    </>
  );
}
