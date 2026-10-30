"use client";

/**
 * Today's outcomes: up to 3 rows (a title, the initiative, a block in minutes) that save by themselves (a moment
 * after typing stops, and when a field loses focus), and a compact "Pick from next actions" list whose "+ Add" fills
 * the next empty row. After the day is closed the rows are read-only and show each outcome's status.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveOutcome } from "@/app/actions/today";
import { DEFAULT_BLOCK_MINUTES, nextEmptyPosition, OUTCOME_STATUS_LABEL, parseBlockMinutes, type NextActionPick, type Outcome } from "@/lib/calc/today";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SAVE_DELAY_MS = 1200;
const STATUS_CLASS: Record<Outcome["status"], string> = {
  planned: "bg-status-neutral-bg text-status-neutral",
  complete: "bg-status-met-bg text-status-met",
  partial: "bg-status-soon-bg text-status-soon",
  incomplete: "bg-status-missed-bg text-status-missed",
};

type RowState = Outcome & { blockText: string };

export function OutcomesEditor({ outcomes, initiatives, picks, locked }: { outcomes: Outcome[]; initiatives: { id: string; name: string }[]; picks: NextActionPick[]; locked: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<RowState[]>(() => outcomes.map((o) => ({ ...o, blockText: o.blockMinutes === null ? "" : String(o.blockMinutes) })));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [, start] = useTransition();
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
  }, [rows]);

  const persistRow = (row: RowState, after?: () => void) => {
    const { position } = row;
    clearTimeout(timers.current[position]);
    start(async () => {
      setNote({ ok: true, text: "Saving..." });
      const r = await saveOutcome({ position, title: row.title, initiativeId: row.initiativeId, pipelineItemId: row.pipelineItemId, taskId: row.taskId, blockMinutes: row.blockText });
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setNote({ ok: true, text: "Saved" });
      setRows((rs) => rs.map((x) => (x.position === position ? { ...x, id: r.id } : x)));
      after?.();
    });
  };
  const persist = (position: number) => {
    const row = latest.current.find((r) => r.position === position);
    if (row) persistRow(row);
  };
  const schedule = (position: number) => {
    clearTimeout(timers.current[position]);
    timers.current[position] = setTimeout(() => persist(position), SAVE_DELAY_MS);
  };
  const update = (position: number, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r) => (r.position === position ? { ...r, ...patch } : r)));
    schedule(position);
  };
  // Leaving the page saves what is still waiting.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.values(t)) clearTimeout(id);
    };
  }, []);

  const empty = nextEmptyPosition(rows);
  const add = (p: NextActionPick) => {
    const position = nextEmptyPosition(latest.current);
    if (!position) return;
    const title = p.forName ? `${p.title}: ${p.forName}` : p.title;
    const current = latest.current.find((r) => r.position === position)!;
    const next: RowState = { ...current, title, initiativeId: p.initiativeId ?? current.initiativeId, pipelineItemId: p.pipelineItemId, taskId: p.taskId, blockText: current.blockText || String(DEFAULT_BLOCK_MINUTES) };
    setRows((rs) => rs.map((r) => (r.position === position ? next : r)));
    persistRow(next, () => router.refresh());
  };

  return (
    <div className="flex flex-col gap-3" data-testid="outcomes">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const blank = !r.title.trim();
          return (
            <li
              key={r.position}
              className={cn("grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 gap-y-1.5", locked ? "sm:grid-cols-[1.25rem_minmax(0,1fr)_10rem_5.5rem_6.5rem]" : "sm:grid-cols-[1.25rem_minmax(0,1fr)_10rem_5.5rem]")}
              data-testid="outcome-row"
              data-position={r.position}
            >
              <span className="tabular text-sm text-slate-400">{r.position}</span>
              <Input
                value={r.title}
                onChange={(e) => update(r.position, { title: e.target.value })}
                onBlur={() => persist(r.position)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder={blank ? "Add an outcome, or pick one below" : ""}
                maxLength={200}
                disabled={locked}
                aria-label={`Outcome ${r.position}`}
                className={cn(blank ? "col-span-2 border-dashed sm:col-span-3" : "col-span-2 sm:col-span-1")}
                data-testid="outcome-title"
              />
              {blank ? null : (
                <>
                  <NativeSelect value={r.initiativeId ?? ""} onChange={(e) => update(r.position, { initiativeId: e.target.value || null })} onBlur={() => persist(r.position)} disabled={locked} aria-label={`Initiative for outcome ${r.position}`} className="col-start-2 sm:col-start-auto" data-testid="outcome-initiative">
                    <option value="">No initiative</option>
                    {initiatives.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <label className="relative block">
                    <Input
                      value={r.blockText}
                      onChange={(e) => update(r.position, { blockText: e.target.value })}
                      onBlur={() => {
                        const n = parseBlockMinutes(r.blockText);
                        setRows((rs) => rs.map((x) => (x.position === r.position ? { ...x, blockText: n === null ? "" : String(n) } : x)));
                        persist(r.position);
                      }}
                      inputMode="numeric"
                      disabled={locked}
                      aria-label={`Block in minutes for outcome ${r.position}`}
                      className="tabular pr-9 text-right"
                      data-testid="outcome-block"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">min</span>
                  </label>
                </>
              )}
              {locked ? (
                <span className={cn("clamp-1 col-start-2 rounded-md px-2 py-1 text-center text-xs font-medium sm:col-start-auto", blank ? "hidden" : STATUS_CLASS[r.status])} data-testid="outcome-status">
                  {r.status === "planned" ? "Not marked" : OUTCOME_STATUS_LABEL[r.status]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {note ? (
        <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-status-missed")} role={note.ok ? "status" : "alert"} data-testid="outcomes-note">
          {note.text}
        </p>
      ) : null}
      {!locked && empty && picks.length ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2" data-testid="pick-list">
          <p className="mb-1 text-xs font-medium text-slate-700">Pick from next actions</p>
          <ul className="flex flex-col divide-y divide-slate-200/70">
            {picks.map((p) => (
              <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-x-3 py-1" data-testid="pick-row">
                <span className="clamp-1 text-sm text-slate-800">
                  {p.title}
                  {p.forName ? <span className="text-muted-foreground"> ({p.forName})</span> : null}
                </span>
                <span className={cn("tabular text-xs", p.overdue ? "text-status-missed" : "text-muted-foreground")}>{p.overdue ? `Due ${fmtDate(p.due, "MMM d")}` : "Due today"}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => add(p)} className="h-7 px-2 text-primary-strong" data-testid="pick-add">
                  <Plus /> Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
