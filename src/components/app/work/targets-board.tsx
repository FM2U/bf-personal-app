"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTarget, editTarget, removeTarget, setCommitment } from "@/app/actions/accountability";
import type { TargetsPage } from "@/lib/accountability/data";
import { COUNTABLES, type TargetView } from "@/lib/accountability/targets";
import { pastWeekPeriodKey } from "@/lib/accountability/periods";
import { date as fmtDate } from "@/lib/format";
import { StatusMark, StripRow, Switch, TargetPill, TargetsLegend } from "@/components/app/work/targets-ui";
import { Figure, Line1, Name, ROW_GRIDS, RowButton, Rows, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Targets (batch C, approved 2026-10-31; Edit batch C): "Past weeks: 2/6 · 3/6 · 2/6 · 3/6" at the top, each figure
 * a link to that week on Reports (the tiles with the misses live there now). One row per target: the name with the
 * target pill ("5 / weekday", "10 / week", "100% on time"), the line of what it counts, the strip of small cells with
 * its met count and streak; the status mark in its own column after a reserved 32px gap; two labeled figures (Today
 * and This week, or This week and Last week) in fixed columns; the Commitment switch and Edit (inline: the number,
 * the cadence, Save, Cancel, Remove target). Add a target (the header button, ?add=1) opens the form above the list.
 * The legend at the foot. Everything is counted from what Bram does in the app; a figure over its target is met.
 */
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const SMALL_INPUT = "h-[30px] rounded-[6px] border border-input bg-white px-2 text-[13px] text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";
/** The fixed figure column (the alignment rule): "19 of 25" at 13.5px semibold, "THIS WEEK" in small caps. */
const FIG = "w-[82px]";
const GRID = ROW_GRIDS.target;

export function TargetsBoard({ data, adding = false }: { data: TargetsPage; adding?: boolean }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      {data.past.length ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-border bg-white px-[18px] py-2.5 text-[13px] text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="past-weeks-line">
          <span className="font-medium text-slate-800">Past weeks:</span>
          {data.past.map((w, i) => (
            <span key={w.weekStart} className="inline-flex items-center gap-2">
              {i ? <span className="text-slate-400" aria-hidden>·</span> : null}
              <Link href={`/work/reports?period=${pastWeekPeriodKey(i + 1)}`} className="tabular font-medium text-primary-strong hover:underline" title={`Week of ${fmtDate(w.weekStart, "MMM d")}: ${w.met} of ${w.total} targets met. Opens Reports.`} aria-label={`Week of ${fmtDate(w.weekStart, "MMM d")}: ${w.met} of ${w.total} targets met`} data-testid="past-week-link" data-period={pastWeekPeriodKey(i + 1)} data-met={w.met}>
                {w.met}/{w.total}
              </Link>
            </span>
          ))}
          <span className="text-xs text-slate-400 sm:ml-auto">Newest first · each opens that week on Reports</span>
        </p>
      ) : null}
      {adding ? <AddTargetForm onClose={() => router.push("/work/targets", { scroll: false })} /> : null}
      <WorkCard
        title="Targets"
        count={data.targets.length}
        actions={
          <span className="hidden text-[13px] text-muted-foreground md:inline" data-testid="targets-hint">
            Commitment: a missed one asks for a reason at End of day
          </span>
        }
        testId="targets-card"
      >
        {data.targets.length ? (
          <Rows testId="target-rows">
            {data.targets.map((t) => (
              <TargetRow key={t.id} t={t} />
            ))}
          </Rows>
        ) : (
          <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="targets-empty">
            No targets yet. Add one above; the app counts it from what you do.
          </p>
        )}
        <TargetsLegend />
      </WorkCard>

    </div>
  );
}

function TargetRow({ t }: { t: TargetView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(String(t.number));
  const [cadence, setCadence] = useState(t.cadence);
  const [commit, setCommit] = useState(t.commitment);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (on: boolean) => {
    setCommit(on);
    setError(null);
    start(async () => {
      const r = await setCommitment(t.id, on);
      if (!r.ok) {
        setCommit(!on);
        return setError(r.error);
      }
      router.refresh();
    });
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await editTarget(t.id, { number, cadence });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      setError(null);
      const r = await removeTarget(t.id);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0", GRID.cls, GRID.gapCls)} data-testid="target-row" data-target={t.name} data-mark={t.mark} data-commitment={commit ? "1" : "0"}>
      <div className={cn("col-span-2 min-w-0 sm:col-span-1", GRID.textMarginCls)} data-row-text>
        <Line1>
          <Name>{t.name}</Name>
          <TargetPill text={t.pill} />
        </Line1>
        {editing ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground" data-testid="target-edit">
            <span>Target</span>
            <input type="number" min={1} max={1000} value={number} onChange={(e) => setNumber(e.target.value)} className={cn(SMALL_INPUT, "w-16")} aria-label="Target number" data-testid="target-edit-number" />
            <select value={cadence} onChange={(e) => setCadence(e.target.value as "day" | "week")} className={SMALL_INPUT} aria-label="How often" data-testid="target-edit-cadence">
              <option value="day">per weekday</option>
              <option value="week">per week</option>
            </select>
            <RowButton tone="primary" onClick={save} disabled={pending} data-testid="target-edit-save">
              Save
            </RowButton>
            <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] font-medium text-primary-strong hover:underline">
              Cancel
            </button>
            <button type="button" onClick={remove} disabled={pending} className="text-[12.5px] font-medium text-status-missed hover:underline sm:ml-auto" data-testid="target-remove">
              Remove target
            </button>
          </div>
        ) : (
          <div className="mt-0.5 text-[13px] text-slate-700" data-testid="target-line">
            {t.line}
          </div>
        )}
        <StripRow strip={t.strip} />
        {error ? (
          <p className="mt-1 text-[13px] text-status-missed" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <StatusMark mark={t.mark} className="justify-self-start" />
      <div className="flex items-end gap-x-5 whitespace-nowrap sm:gap-x-6" data-row-right>
        {t.figures.map((f) => (
          <Figure key={f.label} value={f.value} label={f.label} tone={f.tone === "met" ? "plain" : f.tone === "missed" ? "red" : f.tone === "none" ? "none" : "plain"} className={cn(FIG, f.tone === "met" && "[&>b]:text-status-met")} testId={`target-figure-${f.label.replace(/\s/g, "-").toLowerCase()}`} />
        ))}
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3.5 border-t border-slate-100 pt-2 whitespace-nowrap sm:col-span-1 sm:border-t-0 sm:pt-0" data-col="buttons">
        <Switch on={commit} onChange={toggle} label="Commitment" disabled={pending} testId="commitment-switch" className="min-w-[120px]" />
        <RowButton onClick={() => setEditing((e) => !e)} disabled={editing} className="w-[68px]" data-testid="target-edit-button">
          Edit
        </RowButton>
      </div>
    </div>
  );
}

function AddTargetForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState<string>(COUNTABLES[0].key);
  const [cadence, setCadence] = useState("week");
  const [number, setNumber] = useState("3");
  const [commit, setCommit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await addTarget({ name, key, cadence, number, commitment: commit });
      if (!r.ok) return setError(r.error);
      onClose();
    });
  return (
    <WorkCard title="Add a target" hint="Pick what it counts; the app does the counting" testId="add-target-card">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 px-[22px] pt-3 pb-5 md:grid-cols-[130px_minmax(0,1fr)_130px_minmax(0,1fr)]">
        <label className={LABEL} htmlFor="at-name">
          Name
        </label>
        <input id="at-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What you call it" className={INPUT} data-testid="add-target-name" />
        <label className={LABEL} htmlFor="at-what">
          Counts
        </label>
        <select id="at-what" value={key} onChange={(e) => setKey(e.target.value)} className={INPUT} data-testid="add-target-counts">
          {COUNTABLES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <label className={LABEL} htmlFor="at-cad">
          How often
        </label>
        <select id="at-cad" value={cadence} onChange={(e) => setCadence(e.target.value)} className={INPUT} data-testid="add-target-cadence">
          <option value="day">Per weekday</option>
          <option value="week">Per week</option>
        </select>
        <label className={LABEL} htmlFor="at-num">
          Number
        </label>
        <input id="at-num" type="number" min={1} max={1000} value={number} onChange={(e) => setNumber(e.target.value)} className={INPUT} data-testid="add-target-number" />
        <span className={LABEL}>Commitment</span>
        <div>
          <Switch on={commit} onChange={setCommit} label="Asks for a reason when missed" testId="add-target-commitment" />
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 md:col-span-4">
          {error ? (
            <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="add-target-error">
              {error}
            </span>
          ) : null}
          <RowButton onClick={onClose} data-testid="add-target-cancel">
            Cancel
          </RowButton>
          <RowButton tone="primary" onClick={save} disabled={pending} data-testid="add-target-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </div>
      </div>
    </WorkCard>
  );
}
