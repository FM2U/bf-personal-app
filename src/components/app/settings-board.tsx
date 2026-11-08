"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAiCap, saveStageDefaults, saveWorkSettings } from "@/app/actions/settings";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";
import { WEEK_DAYS, type WorkWeek } from "@/lib/work-week";

/**
 * The parts of the one Settings page (push D, approved mockup 2026-11-02 V.setup) that are typed into: Work settings,
 * Pipelines and stage defaults, and the AI monthly cap. Each card has its own Save; a change not saved yet holds the
 * page (the leave check) until it is saved or dropped.
 */
const INPUT = "h-8 rounded-[7px] border border-input bg-white px-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const NUM = cn(INPUT, "tabular w-[64px] text-right");

type Note = { tone: "ok" | "warn"; text: string } | null;

function NoteLine({ note, testId }: { note: Note; testId: string }) {
  if (!note) return null;
  return (
    <p className={cn("text-[12.5px]", note.tone === "ok" ? "font-medium text-status-met" : "text-status-missed")} role={note.tone === "ok" ? "status" : "alert"} data-testid={testId}>
      {note.text}
    </p>
  );
}

/** One labeled line of a settings card: the label in a fixed column (so the controls line up), the control after it. */
export function KV({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,152px)_minmax(0,1fr)] items-center gap-x-4 border-t border-slate-100 py-2.5 first:border-t-0" data-testid={testId}>
      <span className="text-[13px] text-slate-600">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-900">{children}</span>
    </div>
  );
}

/** A small group label inside a settings card (Bram, 2026-11-08). */
function GroupHead({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return <p className={cn("label-caps figure-label pb-1", first ? "pt-3" : "pt-5")}>{children}</p>;
}

export type WorkSettingsValues = { threshold: number; stalled: number; noReply: number; outreach: number; eodTime: string; blockMinutes: number; autoSend: boolean; workWeek: WorkWeek };

export function WorkSettingsCard({ initial }: { initial: WorkSettingsValues }) {
  const router = useRouter();
  const start0 = { threshold: String(initial.threshold), stalled: String(initial.stalled), autoSend: initial.autoSend, noReply: String(initial.noReply), outreach: String(initial.outreach), eodTime: initial.eodTime, blockMinutes: String(initial.blockMinutes), workDays: [...initial.workWeek.days], weekStart: String(initial.workWeek.start), reviewDay: String(initial.workWeek.review) };
  const [v, setV] = useState(start0);
  const [saved, setSaved] = useState(start0);
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  useUnsavedWork(dirty, "Your Work settings are not saved yet.");
  const toggleDay = (n: number, on: boolean) => {
    setNote(null);
    setV((x) => ({ ...x, workDays: on ? [...new Set([...x.workDays, n])].sort((a, b) => a - b) : x.workDays.filter((d) => d !== n) }));
  };
  const pick = (k: "weekStart" | "reviewDay") => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNote(null);
    setV((x) => ({ ...x, [k]: e.target.value }));
  };
  const set = (k: "threshold" | "stalled" | "noReply" | "outreach" | "eodTime" | "blockMinutes") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setNote(null);
    setV((x) => ({ ...x, [k]: e.target.value }));
  };
  const save = () =>
    start(async () => {
      const r = await saveWorkSettings(v);
      if (!r.ok) return setNote({ tone: "warn", text: r.error });
      setSaved(v);
      setNote({ tone: "ok", text: "Saved" });
      router.refresh();
    });
  return (
    <WorkCard
      id="s-work"
      title="Work settings"
      actions={
        <RowButton tone={dirty ? "primary" : "outline"} onClick={save} disabled={pending || !dirty} className="h-7 px-3 text-xs" data-testid="work-settings-save">
          {pending ? "Saving" : "Save"}
        </RowButton>
      }
      headerClassName="min-h-[76px]"
      testId="work-settings"
    >
      <div className="px-[22px] pt-1 pb-3">
        {/* Bram, 2026-11-08: four labeled groups; Network outreach moved to Targets (one number). */}
        <GroupHead first>Waiting on someone</GroupHead>
        <KV label={<><span className="font-medium text-status-soon">Amber</span> after</>} testId="work-settings-threshold">
          <input value={v.threshold} onChange={set("threshold")} inputMode="numeric" className={NUM} aria-label="Amber after (days)" data-testid="work-threshold" />
          <span>
            days with no answer (time to nudge)
          </span>
        </KV>
        <KV label={<><span className="font-medium text-status-missed">Red</span> after</>} testId="work-settings-stalled">
          <input value={v.stalled} onChange={set("stalled")} inputMode="numeric" className={NUM} aria-label="Red after (days)" data-testid="work-stalled" />
          <span>
            days with no answer (stalled)
          </span>
        </KV>
        <KV label="Unanswered email after" testId="work-settings-no-reply">
          <input value={v.noReply} onChange={set("noReply")} inputMode="numeric" className={NUM} aria-label="Unanswered email after (days)" data-testid="work-no-reply" />
          <span>days: listed under &ldquo;No reply yet&rdquo;</span>
        </KV>
        <GroupHead>Daily report</GroupHead>
        <KV label="Report goes out at" testId="work-settings-eod">
          <input type="time" value={v.eodTime} onChange={set("eodTime")} step={300} className={cn(INPUT, "w-[120px]")} aria-label="Report goes out at" data-testid="work-eod-time" />
          <span>on your partners&apos; days</span>
        </KV>
        <KV label="Send automatically" testId="work-settings-auto">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={v.autoSend}
              onChange={(e) => {
                setNote(null);
                setV((x) => ({ ...x, autoSend: e.target.checked }));
              }}
              className="h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-primary-strong"
              data-testid="work-auto-send"
            />
            <span>{v.autoSend ? "On: the report goes out at that time" : "Off: only the reminder emails"}</span>
          </label>
        </KV>
        <KV label="Weekly review day" testId="work-settings-review">
          <select value={v.reviewDay} onChange={pick("reviewDay")} className={cn(INPUT, "w-[140px]")} aria-label="Weekly review day" data-testid="work-review-day">
            {WEEK_DAYS.map((d) => (
              <option key={d.n} value={String(d.n)}>
                {d.long}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">adds the Weekly review to that day&apos;s report</span>
        </KV>
        <GroupHead>Work week</GroupHead>
        <KV label="Work days" testId="work-settings-days">
          {/* Bram, 2026-11-08: one row of seven columns, the day on top and its box centered under it. */}
          <span className="grid grid-cols-7 gap-x-2.5">
            {WEEK_DAYS.map((d) => (
              <label key={d.n} className="flex w-[30px] cursor-pointer flex-col items-center gap-1" data-testid="work-day" data-day={d.n}>
                <span className="text-[12.5px] leading-4 text-slate-700">{d.short}</span>
                <input type="checkbox" checked={v.workDays.includes(d.n)} onChange={(e) => toggleDay(d.n, e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-primary-strong" aria-label={d.long} />
              </label>
            ))}
          </span>
        </KV>
        <KV label="Week starts on" testId="work-settings-week-start">
          <select value={v.weekStart} onChange={pick("weekStart")} className={cn(INPUT, "w-[120px]")} aria-label="Week starts on" data-testid="work-week-start">
            <option value="1">Monday</option>
            <option value="7">Sunday</option>
          </select>
        </KV>
        <GroupHead>Calendar</GroupHead>
        <KV label="Default block length" testId="work-settings-block">
          <input value={v.blockMinutes} onChange={set("blockMinutes")} inputMode="numeric" className={NUM} aria-label="Default block length (minutes)" data-testid="work-block-minutes" />
          <span>minutes</span>
        </KV>
        <NoteLine note={note} testId="work-settings-note" />
      </div>
    </WorkCard>
  );
}

export type SettingsPipeline = { id: string; kind: "acquisition" | "job" | "consulting"; label: string; groups: { name: string | null; stages: { id: string; name: string; title: string; dueInDays: number | null }[] }[] };

export function PipelinesCard({ pipelines }: { pipelines: SettingsPipeline[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<SettingsPipeline["kind"]>(pipelines[0]?.kind ?? "acquisition");
  const startDraft = () => Object.fromEntries(pipelines.flatMap((p) => p.groups.flatMap((g) => g.stages.map((s) => [s.id, { title: s.title, due: s.dueInDays === null ? "" : String(s.dueInDays) }]))));
  const [draft, setDraft] = useState<Record<string, { title: string; due: string }>>(startDraft);
  const [saved, setSaved] = useState(draft);
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();
  const p = pipelines.find((x) => x.kind === kind) ?? pipelines[0];
  const ids = p ? p.groups.flatMap((g) => g.stages.map((s) => s.id)) : [];
  const dirty = ids.some((id) => JSON.stringify(draft[id]) !== JSON.stringify(saved[id]));
  const anyDirty = Object.keys(draft).some((id) => JSON.stringify(draft[id]) !== JSON.stringify(saved[id]));
  useUnsavedWork(anyDirty, "Your stage defaults are not saved yet.");
  const save = () => {
    if (!p) return;
    start(async () => {
      const r = await saveStageDefaults(p.id, ids.map((id) => ({ stageId: id, title: draft[id]?.title ?? "", dueInDays: draft[id]?.due ?? "" })));
      if (!r.ok) return setNote({ tone: "warn", text: r.error });
      setSaved((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, draft[id]])) }));
      setNote({ tone: "ok", text: `Saved ${p.label}` });
      router.refresh();
    });
  };
  return (
    <WorkCard
      id="s-pipe"
      title="Pipelines and stage defaults"
      sub="The next action a record gets when it enters a stage, and when it is due"
      actions={
        <>
          <span className="inline-flex overflow-hidden rounded-full border border-border bg-white" role="group" aria-label="Pipeline" data-testid="pipeline-choice">
            {pipelines.map((x, i) => (
              <button key={x.kind} type="button" onClick={() => setKind(x.kind)} aria-pressed={kind === x.kind} className={cn("px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", kind === x.kind ? "bg-primary-soft text-primary-strong" : "text-slate-600 hover:bg-slate-50")} data-testid={`pipeline-${x.kind}`}>
                {x.label}
              </button>
            ))}
          </span>
          <RowButton tone={dirty ? "primary" : "outline"} onClick={save} disabled={pending || !dirty} className="h-7 px-3 text-xs" data-testid="stage-defaults-save">
            {pending ? "Saving" : "Save"}
          </RowButton>
        </>
      }
      testId="stage-defaults"
    >
      <div className="px-[22px] pt-1 pb-3" role="table" aria-label={`${p?.label ?? ""} stage defaults`} data-testid="stage-defaults-table" data-pipeline={kind}>
        <div className="hidden grid-cols-[180px_minmax(0,1fr)_110px] items-center gap-x-4 border-b border-slate-100 py-2 sm:grid" role="row">
          <span role="columnheader" className="label-caps text-slate-500">
            Stage
          </span>
          <span role="columnheader" className="label-caps text-slate-500">
            Default next action
          </span>
          <span role="columnheader" className="label-caps text-right text-slate-500">
            Due in (days)
          </span>
        </div>
        {p?.groups.map((g, gi) => (
          <div key={g.name ?? gi} role="rowgroup">
            {g.name ? (
              <div className="label-caps border-b border-slate-100 bg-slate-50 -mx-[22px] px-[22px] py-1.5 text-slate-500" role="row" data-testid="stage-phase">
                {g.name}
              </div>
            ) : null}
            {g.stages.map((s) => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-x-4 gap-y-1.5 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)_110px]" role="row" data-testid="stage-default-row" data-stage={s.name}>
                <span role="cell" className="col-span-2 text-sm font-semibold text-slate-900 sm:col-span-1">
                  {s.name}
                </span>
                <span role="cell" className="min-w-0">
                  <input value={draft[s.id]?.title ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...(d[s.id] ?? { due: "" }), title: e.target.value } }))} placeholder="No default: the record asks for a next action" className={cn(INPUT, "w-full")} aria-label={`Default next action for ${s.name}`} data-testid="stage-default-title" />
                </span>
                <span role="cell" className="flex justify-end">
                  <input value={draft[s.id]?.due ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [s.id]: { ...(d[s.id] ?? { title: "" }), due: e.target.value } }))} inputMode="numeric" className={NUM} aria-label={`Due in days for ${s.name}`} data-testid="stage-default-due" />
                </span>
              </div>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5">
          <p className="text-[12.5px] text-muted-foreground">Rosara projects have no stages. Passed and Lost ask for a reason instead of a next action.</p>
          <NoteLine note={note} testId="stage-defaults-note" />
        </div>
      </div>
    </WorkCard>
  );
}

export function AiCapInput({ cap }: { cap: number }) {
  const router = useRouter();
  const [v, setV] = useState(String(cap));
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();
  const dirty = v !== String(cap);
  useUnsavedWork(dirty, "The AI monthly cap is not saved yet.");
  const save = () =>
    start(async () => {
      const r = await saveAiCap(v);
      if (!r.ok) return setNote({ tone: "warn", text: r.error });
      setNote({ tone: "ok", text: "Saved" });
      router.refresh();
    });
  return (
    <>
      <span>$</span>
      <input value={v} onChange={(e) => (setNote(null), setV(e.target.value))} inputMode="decimal" className={NUM} aria-label="AI monthly cap in dollars" data-testid="ai-cap-input" />
      {dirty ? (
        <RowButton tone="primary" onClick={save} disabled={pending} className="h-7 px-2.5 text-xs" data-testid="ai-cap-save">
          Save
        </RowButton>
      ) : null}
      <NoteLine note={note} testId="ai-cap-note" />
    </>
  );
}

/**
 * The section pills under the Settings title (2026-11-06, approved by Bram): the pill of the section at the top of the
 * window looks selected, with the same cobalt outline as a selected tile on Home, and changes as the page scrolls. A
 * click scrolls to that section and selects its pill (cards side by side share a top, so the click decides which one).
 */
export function SettingsSectionNav({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const [current, setCurrent] = useState<string>(sections[0]?.[0] ?? "");
  const clickedAt = useRef(0);
  useEffect(() => {
    const pick = () => {
      // A click's own smooth scroll does not change the pill the click chose.
      if (Date.now() - clickedAt.current < 900) return;
      const top = (document.querySelector<HTMLElement>("[data-testid=settings-sticky]")?.getBoundingClientRect().bottom ?? 0) + 12;
      let id = sections[0]?.[0] ?? "";
      for (const [sid] of sections) {
        const el = document.getElementById(sid);
        if (el && el.getBoundingClientRect().top <= top) id = sid;
      }
      // Cards side by side share a top: the first of that row stands for it.
      const rowTop = document.getElementById(id)?.getBoundingClientRect().top;
      const first = sections.find(([sid]) => document.getElementById(sid)?.getBoundingClientRect().top === rowTop);
      setCurrent(first ? first[0] : id);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [sections]);
  return (
    <nav className="mt-2.5 flex flex-wrap items-center gap-2" aria-label="Settings sections" data-testid="settings-sections">
      {sections.map(([id, label]) => {
        const on = current === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              // The section's heading lands just under the pinned title and pills (2026-11-06, Bram: the plain jump hid it).
              const el = document.getElementById(id);
              if (!el) return;
              e.preventDefault();
              clickedAt.current = Date.now();
              setCurrent(id);
              const pinned = document.querySelector<HTMLElement>("[data-testid=settings-sticky]")?.getBoundingClientRect().bottom ?? 0;
              window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - pinned - 12), behavior: "smooth" });
              try {
                window.history.replaceState(null, "", `#${id}`);
              } catch {
                /* no history: the scroll still happens */
              }
            }}
            aria-current={on ? "true" : undefined}
            className={cn("inline-flex items-center rounded-full border bg-white px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", on ? "border-primary text-primary-strong shadow-[0_0_0_1px_var(--primary)]" : "border-border text-slate-600 hover:bg-slate-50")}
            data-testid="settings-section-pill"
            data-section={id}
            data-selected={on ? "1" : "0"}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
