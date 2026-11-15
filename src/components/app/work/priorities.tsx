"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { draftField } from "@/app/actions/ask-ai";
import { markDecided, priorityCandidates, savePriorityFields, setPriorityRank, type PriorityCandidate } from "@/app/actions/priorities";
import { cn } from "@/lib/utils";
import { MAX_PICKS, nextWords, PRIORITY_TRACKS, shortDay, STRENGTHS, type PriorityKind, type PriorityPick, type Strength } from "@/lib/work/priorities";
import type { PrioritiesData, RecordPriority } from "@/lib/work/priorities-data";
import { AiButton, RowButton, WorkCard } from "@/components/app/work/ui";

/**
 * Top priorities (Bram, 2026-11-15; mockup 2026-11-15-top-priorities-app-mockup.png). The card: on Home the four
 * tracks side by side; on Deals, Job search, Consulting and Rosara the page's own track, its picks side by side. Each
 * pick keeps the same four lines (name; stage, How strong, day, moved today; Why; Next), each cut to one line, so picks
 * side by side line up. A "+ Choose" slot adds an open record of the track. On a record page: the star pill next to
 * the stage (its place, or "Make a top priority"), and the Priority card (Why it fits, How strong, Next decision).
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const STRENGTH_DOT: Record<Strength, string> = { hot: "bg-[#dc2626]", warm: "bg-[#d97706]", cold: "bg-[#2563eb]" };
const STRENGTH_TEXT: Record<Strength, string> = { hot: "text-[#dc2626]", warm: "text-[#b45309]", cold: "text-[#2563eb]" };
const PAGE_OF: Record<PriorityKind, "deal" | "opportunity" | "consulting_item" | "project"> = { acquisition: "deal", job: "opportunity", consulting: "consulting_item", startup: "project" };

function StrengthMark({ value }: { value: Strength | null }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold", STRENGTH_TEXT[value])} data-testid="pick-strength">
      <span className={cn("h-2 w-2 rounded-full", STRENGTH_DOT[value])} aria-hidden />
      {STRENGTHS.find((s) => s.value === value)?.label}
    </span>
  );
}

function Pick({ p, divided = false }: { p: PriorityPick; /** A hairline above every pick but the first (picks stacked in a column); the first has a clear one, so heights match. */ divided?: boolean }) {
  const next = nextWords(p.next);
  return (
    <div className={cn("grid min-w-0 grid-cols-[22px_minmax(0,1fr)] py-2.5", divided && "border-t border-rule first:border-transparent")} data-testid="priority-pick" data-kind={p.kind} data-number={p.number}>
      <span className="text-[14px] font-bold leading-[21px] text-primary-strong tabular">{p.number}</span>
      <div className="min-w-0 text-[13px] leading-[21px]">
        <Link href={p.href} className="block truncate text-[14px] font-semibold text-heading hover:underline" data-testid="pick-name">
          {p.name}
        </Link>
        <div className="flex h-[23px] min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          {p.stage ? <span className="min-w-0 truncate rounded-full border border-border bg-slate-50 px-2 text-[12px] leading-[19px] text-slate-700" data-testid="pick-stage">{p.stage}</span> : null}
          <StrengthMark value={p.strength} />
          {p.day ? <span className="shrink-0 text-[12.5px] text-muted-foreground tabular" data-testid="pick-day">day {p.day}</span> : null}
          {p.movedToday ? (
            <span className="shrink-0 text-[12.5px] font-semibold text-status-met" data-testid="pick-moved">
              ▲ moved today
            </span>
          ) : null}
        </div>
        <p className="truncate text-slate-600" data-testid="pick-why" title={p.why ?? undefined}>
          Why: {p.why ?? <span className="text-slate-400">not written yet</span>}
        </p>
        <p className={cn("truncate", next?.amber ? "text-[#b45309]" : "text-slate-600")} data-testid="pick-next" data-amber={next?.amber ? "1" : "0"} title={next?.words}>
          <span className="text-slate-600">Next: </span>
          {next ? next.words : <span className="text-slate-400">no decision set</span>}
        </p>
      </div>
    </div>
  );
}

/** "+ Choose a job": the open records of the track that are not picks yet; one click adds it at the next place. */
function ChooseSlot({ kind, place }: { kind: PriorityKind; place: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PriorityCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const show = () => {
    setOpen(true);
    setError(null);
    setList(null);
    start(async () => {
      const r = await priorityCandidates(kind);
      if (!r.ok) return setError(r.error);
      setList(r.list);
    });
  };
  const choose = (c: PriorityCandidate) =>
    start(async () => {
      const r = await setPriorityRank({ table: c.table, id: c.id, to: place });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const t = PRIORITY_TRACKS[kind];
  return (
    <div ref={box} className="relative py-2.5" data-testid="priority-slot" data-kind={kind}>
      <button type="button" onClick={() => (open ? setOpen(false) : show())} className="flex h-[42px] w-full items-center rounded-lg border border-dashed border-slate-300 px-3.5 text-left text-[13.5px] font-semibold text-primary-strong hover:bg-primary-soft" data-testid="priority-choose">
        + {t.choose}
      </button>
      {open ? (
        <div className="absolute top-[58px] right-0 left-0 z-20 rounded-lg border border-border bg-white p-2 shadow-lg" data-testid="priority-choices">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find a ${t.noun}`} className={INPUT} autoFocus data-testid="priority-find" />
          <div className="mt-1.5 max-h-[260px] overflow-y-auto">
            {error ? <p className="px-2 py-2 text-[13px] text-status-missed">{error}</p> : null}
            {!list && !error ? <p className="px-2 py-2 text-[13px] text-muted-foreground">Loading…</p> : null}
            {list && !list.length ? <p className="px-2 py-2 text-[13px] text-muted-foreground">{t.none}</p> : null}
            {list && list.length && !shown.length ? <p className="px-2 py-2 text-[13px] text-muted-foreground">None match.</p> : null}
            {shown.map((c) => (
              <button key={c.id} type="button" disabled={pending} onClick={() => choose(c)} className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-slate-50 disabled:opacity-60" data-testid="priority-choice">
                <span className="truncate font-medium text-heading">{c.name}</span>
                {c.stage ? <span className="shrink-0 text-[12px] text-muted-foreground">{c.stage}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Track({ kind, picks, layout }: { kind: PriorityKind; picks: PriorityPick[]; layout: "column" | "row" }) {
  const t = PRIORITY_TRACKS[kind];
  const slot = picks.length < MAX_PICKS ? <ChooseSlot kind={kind} place={picks.length + 1} /> : null;
  if (layout === "row") {
    return (
      <div className="grid grid-cols-1 gap-x-7 px-[22px] pb-2 md:grid-cols-3" data-testid="priority-track" data-kind={kind}>
        {picks.map((p) => (
          <Pick key={p.id} p={p} />
        ))}
        {slot}
      </div>
    );
  }
  return (
    <div className="min-w-0 px-[22px] pt-3.5 pb-2" data-testid="priority-track" data-kind={kind}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps text-heading">{t.label}</span>
        <span className="text-[12.5px] text-muted-foreground tabular" data-testid="priority-count">
          {kind === "startup" ? "initiatives" : `${picks.length} of ${MAX_PICKS}`}
        </span>
      </div>
      <div className="mt-1">
        {picks.map((p) => (
          <Pick key={p.id} p={p} divided />
        ))}
      </div>
      {slot}
    </div>
  );
}

/** The Top priorities card: Home shows every track; a track's page shows its own. */
export function TopPrioritiesCard({ data, kinds, className }: { data: PrioritiesData; kinds: readonly PriorityKind[]; className?: string }) {
  const one = kinds.length === 1;
  const title = one ? `Top priorities · ${PRIORITY_TRACKS[kinds[0]].label}` : "Top priorities";
  const hint = "What you're pushing forward now. Your partners see these in every report.";
  if (!data.ready) {
    return (
      <WorkCard title={title} hint={hint} className={className} testId="top-priorities">
        <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="priority-notice">
          {data.notice}
        </p>
      </WorkCard>
    );
  }
  return (
    <WorkCard title={title} hint={hint} className={className} testId="top-priorities" bodyClassName={one ? "pt-1" : undefined}>
      {one ? (
        <Track kind={kinds[0]} picks={data.columns[kinds[0]]} layout="row" />
      ) : (
        <div className="grid grid-cols-1 divide-y divide-rule sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x" data-testid="priority-tracks">
          {kinds.map((k) => (
            <Track key={k} kind={k} picks={data.columns[k]} layout="column" />
          ))}
        </div>
      )}
    </WorkCard>
  );
}

// ---------- On a record page ----------

/** Next to the stage: "★ Top priority · #1" (or "☆ Make a top priority"); a click shows the places and Remove. */
export function PriorityStar({ data, open }: { data: RecordPriority; /** The record is open (closed records and listings show nothing). */ open: boolean }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  if (!data.ready || !open) return null;
  const put = (to: number | null) =>
    start(async () => {
      setError(null);
      const r = await setPriorityRank({ table: data.table, id: data.id, to });
      if (!r.ok) return setError(r.error);
      setMenu(false);
      router.refresh();
    });
  // A place past the end of the list would close up to the next free one, so only reachable places are offered.
  const last = data.number ? data.track.length : Math.min(MAX_PICKS, data.track.length + 1);
  const places = Array.from({ length: last }, (_, i) => i + 1).map((n) => ({ n, holder: data.track.find((p) => p.number === n) ?? null }));
  return (
    <span ref={box} className="relative inline-flex" data-testid="priority-star-wrap">
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-[9px] py-0.5 text-xs font-semibold whitespace-nowrap", data.number ? "border-primary bg-white text-primary-strong" : "border-dashed border-slate-300 bg-white text-slate-500 hover:text-primary-strong")}
        data-testid="priority-star"
        data-number={data.number ?? ""}
      >
        {data.number ? `★ Top priority · #${data.number}` : "☆ Make a top priority"}
      </button>
      {menu ? (
        <span className="absolute top-[28px] left-0 z-30 flex w-[290px] flex-col rounded-lg border border-border bg-white p-1.5 text-[13px] shadow-lg" data-testid="priority-menu">
          {places.map(({ n, holder }) => (
            <button key={n} type="button" disabled={pending || data.number === n} onClick={() => put(n)} className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 disabled:text-slate-400" data-testid="priority-place">
              <span className="shrink-0 font-semibold">#{n}</span>
              <span className="truncate text-muted-foreground">{holder ? (holder.id === data.id ? "here now" : `now ${holder.name}`) : "empty"}</span>
            </button>
          ))}
          {data.number ? (
            <button type="button" disabled={pending} onClick={() => put(null)} className="mt-1 rounded-md border-t border-rule px-2 py-1.5 text-left text-status-missed hover:bg-slate-50" data-testid="priority-remove">
              Remove from top priorities
            </button>
          ) : null}
          {error ? <span className="px-2 py-1 text-status-missed">{error}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

const ROW = "grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-slate-100 py-3 first:border-t-0 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-start";
const LABEL = "pt-2 text-[13px] text-slate-600";

/** The Priority card at the top of a deal, job, consulting or Rosara project page: Why it fits, How strong, Next decision. */
export function PriorityCard({ data, label, open = true }: { data: RecordPriority; /** The record's name (for the AI draft). */ label: string; /** The record is open (a closed one cannot be a top priority). */ open?: boolean }) {
  const router = useRouter();
  const [why, setWhy] = useState(data.ready ? data.whyFits : "");
  const [strength, setStrength] = useState<Strength | null>(data.ready ? data.strength : null);
  const [next, setNext] = useState(data.ready ? data.nextDecision : "");
  const [nextOn, setNextOn] = useState(data.ready ? (data.nextDecisionOn ?? "") : "");
  const [saved, setSaved] = useState({ why, next, nextOn });
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState<"go" | "no_go" | null>(null);
  const [line, setLine] = useState("");
  const [pending, start] = useTransition();
  if (!data.ready) {
    return (
      <WorkCard title="Priority" testId="priority-card">
        <p className="px-[22px] py-4 text-[13px] text-muted-foreground">{data.notice}</p>
      </WorkCard>
    );
  }
  const save = (patch: Parameters<typeof savePriorityFields>[0], after?: () => void, undo?: () => void) =>
    start(async () => {
      setNote(null);
      const r = await savePriorityFields(patch);
      if (!r.ok) {
        undo?.();
        return setNote({ tone: "warn", text: r.error });
      }
      after?.();
      setNote({ tone: "ok", text: "Saved" });
      router.refresh();
    });
  const base = { table: data.table, id: data.id };
  const saveWhy = (text = why) => {
    if (text.trim() === saved.why.trim()) return;
    save({ ...base, whyFits: text }, () => setSaved((s) => ({ ...s, why: text })));
  };
  const saveNext = () => {
    if (next.trim() === saved.next.trim() && nextOn === saved.nextOn) return;
    save({ ...base, nextDecision: next, nextDecisionOn: nextOn || null }, () => setSaved((s) => ({ ...s, next, nextOn })));
  };
  const draft = async () => {
    setDrafting(true);
    setNote(null);
    const r = await draftField({ page: PAGE_OF[data.kind], recordId: data.id, label, field: { key: "why_fits", label: "Why it fits", current: why || null, extra: `The record: ${label}` } });
    setDrafting(false);
    if (!r.ok) return setNote({ tone: "warn", text: r.error });
    setWhy(r.text);
    saveWhy(r.text);
  };
  const decide = () =>
    start(async () => {
      if (!outcome) return setNote({ tone: "warn", text: "Pick Go or No-go." });
      const r = await markDecided({ ...base, outcome, line });
      if (!r.ok) return setNote({ tone: "warn", text: r.error });
      setDeciding(false);
      setOutcome(null);
      setLine("");
      setNext("");
      setNextOn("");
      setSaved((s) => ({ ...s, next: "", nextOn: "" }));
      setNote({ tone: "ok", text: "Decision saved" });
      router.refresh();
    });
  return (
    <WorkCard title="Priority" hint={note ? <span className={note.tone === "ok" ? "text-status-met" : "text-status-missed"} data-testid="priority-note">{note.text}</span> : !open ? "Closed: not a top priority" : data.number ? `Top priority #${data.number}` : "Make it a top priority with the star next to the stage"} testId="priority-card">
      <div className="px-[22px] pb-2">
        <div className={ROW}>
          <span className={LABEL}>Why it fits</span>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} onBlur={() => saveWhy()} readOnly={drafting} rows={2} maxLength={400} placeholder="What it is · why now · why it fits you" className={cn(INPUT, "h-auto min-h-[58px] resize-y py-2 leading-[19px]")} data-testid="priority-why" />
            <AiButton busy={drafting} onClick={draft} tone="soft" className="shrink-0" data-testid="priority-draft">
              Draft with AI
            </AiButton>
          </div>
        </div>
        <div className={ROW}>
          <span className={LABEL}>How strong</span>
          <div className="inline-flex w-fit overflow-hidden rounded-[7px] border border-input" role="group" aria-label="How strong" data-testid="priority-strength">
            {STRENGTHS.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={strength === s.value}
                onClick={() => {
                  const was = strength;
                  const v = strength === s.value ? null : s.value;
                  setStrength(v);
                  save({ ...base, strength: v }, undefined, () => setStrength(was));
                }}
                className={cn("flex h-9 items-center gap-1.5 border-l border-input px-3.5 text-[13px] font-medium first:border-l-0", strength === s.value ? cn("bg-slate-50", STRENGTH_TEXT[s.value]) : "bg-white text-slate-600 hover:bg-slate-50")}
                data-testid="priority-strength-option"
                data-value={s.value}
              >
                {strength === s.value ? <span className={cn("h-2 w-2 rounded-full", STRENGTH_DOT[s.value])} aria-hidden /> : null}
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className={ROW}>
          <span className={LABEL}>Next decision</span>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
              <input value={next} onChange={(e) => setNext(e.target.value)} onBlur={saveNext} maxLength={200} placeholder="Go or no-go on an LOI" className={INPUT} data-testid="priority-next" />
              <input type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} onBlur={saveNext} className={cn(INPUT, "tabular")} aria-label="Decide by" data-testid="priority-next-on" />
            </div>
            {deciding ? (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-slate-50 p-2.5 sm:flex-row sm:items-center" data-testid="priority-decide">
                <div className="inline-flex w-fit overflow-hidden rounded-[7px] border border-input bg-white" role="group" aria-label="Outcome">
                  {(["go", "no_go"] as const).map((o) => (
                    <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)} className={cn("h-9 border-l border-input px-3.5 text-[13px] font-semibold first:border-l-0", outcome === o ? (o === "go" ? "bg-status-met-bg text-status-met" : "bg-status-missed-bg text-status-missed") : "text-slate-600")} data-testid="priority-outcome" data-value={o}>
                      {o === "go" ? "Go" : "No-go"}
                    </button>
                  ))}
                </div>
                <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={300} placeholder="One line: why" className={INPUT} data-testid="priority-decide-line" />
                <div className="flex shrink-0 gap-2">
                  <RowButton tone="primary" disabled={pending} onClick={decide} data-testid="priority-decide-save">
                    Save
                  </RowButton>
                  <RowButton onClick={() => setDeciding(false)}>Cancel</RowButton>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <RowButton onClick={() => setDeciding(true)} data-testid="priority-mark-decided">
                  Mark decided
                </RowButton>
                {data.lastDecision ? (
                  <span className="text-[12.5px] text-muted-foreground" data-testid="priority-last-decision">
                    Decided {shortDay(data.lastDecision.on)}: {data.lastDecision.outcome === "go" ? "go" : "no-go"}
                    {data.lastDecision.line ? ` (${data.lastDecision.line})` : ""}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkCard>
  );
}

