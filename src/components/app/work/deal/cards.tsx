"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { addDealNote, advanceDeal, markLost, passDeal, saveFacts, saveFindings, saveNextAction, type FactsInput } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { LISTING_SOURCES, moneyShort, type PassReason } from "@/lib/work/buy-box";
import type { DealRow, Stage, TimelineEvent } from "@/lib/work/data";
import { dueLabel } from "@/lib/work/stages";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { PassMenu } from "@/components/app/work/listing-row";
import { Pill, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the deal page (/work/deals/[id]). Each card saves through its own server action and shows "Saved" or
 * the error next to its button; typed text stays in place either way. The page re-reads after a successful save.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

function SaveLine({ state, children }: { state: { kind: "idle" } | { kind: "saved" } | { kind: "error"; text: string }; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
      {state.kind === "saved" ? (
        <span className="text-[13px] font-medium text-status-met" role="status" data-testid="save-ok">
          Saved
        </span>
      ) : null}
      {state.kind === "error" ? (
        <span className="text-[13px] text-status-missed" role="alert" data-testid="save-error">
          {state.text}
        </span>
      ) : null}
      {children}
    </div>
  );
}

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "error"; text: string };

/** Field state that follows its saved value: after a save the page re-reads and the field shows what was saved. */
function useSynced<T>(value: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setState(value);
  }
  return [state, setState];
}

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "saved" });
      after?.();
      router.refresh();
    });
  return { pending, state, run, reset: () => setState({ kind: "idle" }) };
}

// ---------- Header ----------

export function DealHeaderActions({ deal, compose, advanceTo }: { deal: DealRow; compose: ComposeSetup | null; advanceTo: Stage | null }) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = deal.status === "open";
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Not saved.");
      router.refresh();
    });
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        <RowButton onClick={() => document.getElementById("deal-note")?.focus()} className="h-9 px-3.5 text-[13px]" data-testid="deal-add-note">
          Add a note
        </RowButton>
        {compose ? (
          <RowButton onClick={() => setEmailOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="deal-email">
            <Mail className="mr-1.5 h-3.5 w-3.5" /> {deal.brokerName || deal.contactName ? "Email the broker" : "Email"}
          </RowButton>
        ) : null}
        {open && advanceTo ? (
          <RowButton tone="gold" onClick={() => act(() => advanceDeal(deal.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="deal-advance">
            {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
          </RowButton>
        ) : null}
        {open ? <PassMenu onPick={(reason: PassReason) => act(() => passDeal(deal.id, reason))} pending={pending} testId="deal-pass" /> : null}
      </div>
      {error ? (
        <span className="text-[13px] text-status-missed" role="alert" data-testid="deal-action-error">
          {error}
        </span>
      ) : null}
      {compose && emailOpen ? <ComposeEmailDialog setup={compose} open={emailOpen} onOpenChange={setEmailOpen} /> : null}
    </div>
  );
}

// ---------- Next action ----------

export function NextActionCard({ deal, today }: { deal: DealRow; today: string }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [action, setAction] = useSynced(deal.nextAction ?? "");
  const [due, setDue] = useSynced(deal.nextActionDue ?? "");
  const [minutes, setMinutes] = useSynced(deal.nextActionMinutes ? String(deal.nextActionMinutes) : "");
  const [waitingOn, setWaitingOn] = useSynced(deal.waitingOn ?? "");
  const [since, setSince] = useSynced(deal.waitingSince ?? today);
  const dirty = action !== (deal.nextAction ?? "") || due !== (deal.nextActionDue ?? "") || minutes !== (deal.nextActionMinutes ? String(deal.nextActionMinutes) : "") || waitingOn !== (deal.waitingOn ?? "") || (waitingOn !== "" && since !== (deal.waitingSince ?? today));
  useUnsavedWork(dirty, "The next action is not saved yet.");
  const d = deal.nextAction ? dueLabel(deal.nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  const hint = deal.nextAction ? `Due ${d!.text.toLowerCase() === "today" ? "today" : d!.text}${deal.nextActionMinutes ? ` · ${deal.nextActionMinutes} min` : ""}` : "Needs a next action";
  return (
    <WorkCard title="Next action" hint={hint} testId="deal-next-action">
      <div className={FORM} data-testid="next-action-form">
        <label htmlFor={`${ids}-a`} className={LABEL}>
          Action
        </label>
        <input id={`${ids}-a`} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What you do next on this deal" className={INPUT} data-testid="na-action" />
        <label htmlFor={`${ids}-d`} className={LABEL}>
          Due
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${ids}-d`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="na-due" />
          <label htmlFor={`${ids}-m`} className={LABEL}>
            Block
          </label>
          <input id={`${ids}-m`} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} inputMode="numeric" placeholder="min" className={cn(INPUT, "w-20")} data-testid="na-minutes" />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
        <label htmlFor={`${ids}-w`} className={LABEL}>
          Waiting on
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${ids}-w`} value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} placeholder="Nobody" className={cn(INPUT, "min-w-[160px] flex-1")} data-testid="na-waiting" />
          {waitingOn.trim() ? (
            <>
              <label htmlFor={`${ids}-s`} className={LABEL}>
                Since
              </label>
              <input id={`${ids}-s`} type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="na-since" />
            </>
          ) : null}
        </div>
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          {dirty ? (
            <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveNextAction(deal.id, { action, due, minutes, waitingOn, waitingSince: since }))} data-testid="na-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          ) : deal.nextAction && deal.status === "open" ? (
            <NextActionRow key={`${deal.nextAction}|${deal.stageName}|${deal.nextActionDue}`} deal={deal} today={today} compact />
          ) : null}
        </SaveLine>
      </div>
    </WorkCard>
  );
}

// ---------- Findings ----------

export function FindingsCard({ deal }: { deal: DealRow }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [key, setKey] = useSynced(deal.keyFinding ?? "");
  const [questions, setQuestions] = useSynced(deal.openQuestions ?? "");
  const dirty = key !== (deal.keyFinding ?? "") || questions !== (deal.openQuestions ?? "");
  useUnsavedWork(dirty, "The findings are not saved yet.");
  return (
    <WorkCard title="Findings" hint="One line that decides it, and what to ask" testId="deal-findings">
      <div className={FORM} data-testid="findings-form">
        <label htmlFor={`${ids}-k`} className={LABEL}>
          Key finding
        </label>
        <input id={`${ids}-k`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="The one line that matters most" className={INPUT} data-testid="key-finding" />
        <label htmlFor={`${ids}-q`} className={cn(LABEL, "sm:self-start sm:pt-2")}>
          Open questions
        </label>
        <textarea id={`${ids}-q`} value={questions} onChange={(e) => setQuestions(e.target.value)} rows={3} placeholder="One per line, for the broker or the seller" className={cn(INPUT, "h-auto min-h-[72px] resize-y py-2")} data-testid="open-questions" />
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveFindings(deal.id, { keyFinding: key, openQuestions: questions }))} data-testid="findings-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </SaveLine>
      </div>
    </WorkCard>
  );
}

// ---------- Facts ----------

/** "transworld.com/..." for a long address: the host without www, then "/..." when there is a path. */
function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    return u.pathname && u.pathname !== "/" ? `${host}/...` : host;
  } catch {
    return url.slice(0, 30);
  }
}

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <span className="text-[11px] font-semibold tracking-[0.06em] text-slate-400 uppercase">{label}</span>
      <b className="min-w-0 text-sm font-medium break-words text-slate-900">{children}</b>
    </div>
  );
}

export function FactsCard({ deal }: { deal: DealRow }) {
  const ids = useId();
  const { pending, state, run, reset } = useSave();
  const [editing, setEditing] = useState(false);
  const initial = (): FactsInput => ({
    name: deal.name,
    whatItDoes: deal.whatItDoes ?? "",
    location: deal.location ?? "",
    revenue: deal.revenue === null ? "" : moneyShort(deal.revenue),
    ebitda: deal.ebitda === null ? "" : moneyShort(deal.ebitda),
    sde: deal.sde === null ? "" : moneyShort(deal.sde),
    askingPrice: deal.askingPrice === null ? "" : moneyShort(deal.askingPrice),
    industry: deal.industry ?? "",
    brokerName: deal.brokerName ?? "",
    source: deal.source ?? "",
    whySelling: deal.whySelling ?? "",
    listingUrl: deal.listingUrl ?? "",
  });
  const initialKey = JSON.stringify(initial());
  const [f, setF] = useState<FactsInput>(initial);
  const [prevKey, setPrevKey] = useState(initialKey);
  if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    setF(initial());
  }
  const dirty = editing && JSON.stringify(f) !== initialKey;
  useUnsavedWork(dirty, "The facts are not saved yet.");
  const set = (k: keyof FactsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof FactsInput, label: string, placeholder = "") => (
    <div key={k} className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      {k === "source" ? (
        <select id={`${ids}-${k}`} value={(LISTING_SOURCES as readonly string[]).includes(f.source) ? f.source : f.source ? "__other" : ""} onChange={(e) => setF((x) => ({ ...x, source: e.target.value === "__other" ? x.source : e.target.value }))} className={INPUT} data-testid={`fact-${k}`}>
          <option value="">Not set</option>
          {LISTING_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {f.source && !(LISTING_SOURCES as readonly string[]).includes(f.source) ? <option value="__other">{f.source}</option> : null}
        </select>
      ) : (
        <input id={`${ids}-${k}`} value={f[k]} onChange={set(k)} placeholder={placeholder} className={INPUT} data-testid={`fact-${k}`} />
      )}
    </div>
  );
  const link = deal.listingUrl ? (deal.listingUrl.startsWith("http") ? deal.listingUrl : `https://${deal.listingUrl}`) : null;
  return (
    <WorkCard
      title="Facts"
      hint={!editing ? "Buy box" : undefined}
      actions={
        <RowButton
          onClick={() => {
            if (editing) setF(initial());
            reset();
            setEditing((e) => !e);
          }}
          disabled={pending}
          data-testid="facts-edit"
        >
          {editing ? "Cancel" : "Edit"}
        </RowButton>
      }
      testId="deal-facts"
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-2" data-testid="facts-form">
          <div className="sm:col-span-2">{field("name", "Name")}</div>
          <div className="sm:col-span-2">{field("whatItDoes", "What it does", "The product or service and who buys it")}</div>
          {field("revenue", "Revenue", "$5.6M")}
          {field("ebitda", "EBITDA", "$1.7M")}
          {field("sde", "SDE", "")}
          {field("askingPrice", "Asking price", "$6.0M")}
          {field("industry", "Industry")}
          {field("location", "Location", "City, ST")}
          {field("brokerName", "Broker", "Firm, person")}
          {field("source", "Source")}
          <div className="sm:col-span-2">{field("whySelling", "Why selling", "Retiring, no successor")}</div>
          <div className="sm:col-span-2">{field("listingUrl", "Link", "https://")}</div>
          <SaveLine state={state}>
            <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveFacts(deal.id, f), () => setEditing(false))} data-testid="facts-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          </SaveLine>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5 md:grid-cols-4" data-testid="facts-grid">
          <Fact label="Revenue" testId="fact-revenue">
            {moneyShort(deal.revenue)}
          </Fact>
          <Fact label="EBITDA" testId="fact-ebitda">
            {moneyShort(deal.ebitda)}
          </Fact>
          <Fact label="SDE">{moneyShort(deal.sde)}</Fact>
          <Fact label="Asking" testId="fact-asking">
            {moneyShort(deal.askingPrice)}
            {deal.askingMultiple ? <span className="font-normal text-muted-foreground"> ({deal.askingMultiple})</span> : null}
          </Fact>
          <Fact label="Industry">{deal.industry ?? "Not set"}</Fact>
          <Fact label="Broker">{deal.brokerName ?? deal.contactName ?? "Not set"}</Fact>
          <Fact label="Source">{deal.source ?? "Not set"}</Fact>
          <Fact label="Why selling">{deal.whySelling ?? "Not known"}</Fact>
          <Fact label="Link">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" title={link} className="block truncate text-primary-strong hover:underline" data-testid="fact-link">
                {linkLabel(link)}
              </a>
            ) : (
              "Not set"
            )}
          </Fact>
          {state.kind === "saved" ? (
            <span className="self-end text-[13px] font-medium text-status-met" role="status" data-testid="save-ok">
              Saved
            </span>
          ) : null}
        </div>
      )}
    </WorkCard>
  );
}

// ---------- Timeline ----------

const ICON: Record<TimelineEvent["kind"], { text: string; cls: string }> = {
  note: { text: "N", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  email: { text: "E", cls: "border-gold-border bg-gold-soft text-gold-strong" },
  call: { text: "C", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  move: { text: "→", cls: "border-primary-border bg-primary-soft text-primary-strong" },
  other: { text: "·", cls: "border-border bg-status-neutral-bg text-status-neutral" },
};

export function TimelineCard({ deal, events }: { deal: DealRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  return (
    <WorkCard title="Timeline" hint="Newest first" testId="deal-timeline">
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-2" data-testid="note-form">
        <textarea id="deal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note: what you learned, who said what" className={cn(INPUT, "h-auto min-h-[56px] resize-y py-2")} data-testid="deal-note" />
        <div className="flex items-center justify-end gap-3">
          {state.kind === "error" ? (
            <span className="text-[13px] text-status-missed" role="alert" data-testid="save-error">
              {state.text}
            </span>
          ) : null}
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addDealNote(deal.id, note), () => setNote(""))} data-testid="note-save">
            {pending ? "Saving..." : "Add note"}
          </RowButton>
        </div>
      </div>
      <div className="px-[22px] pt-1 pb-4" data-testid="timeline-events">
        {events.length ? (
          events.map((e) => (
            <div key={e.id} className="grid grid-cols-[56px_22px_minmax(0,1fr)] gap-x-2.5 border-b border-slate-100 py-[9px] last:border-b-0" data-testid="timeline-event" data-kind={e.kind}>
              <span className="pt-0.5 text-xs text-muted-foreground">{e.date}</span>
              <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-bold", ICON[e.kind].cls)} aria-hidden>
                {ICON[e.kind].text}
              </span>
              <span className="min-w-0 text-sm text-slate-900">
                {e.href ? (
                  <Link href={e.href} className="hover:underline">
                    {e.title}
                  </Link>
                ) : (
                  e.title
                )}
                {e.detail ? <span className="block text-[12.5px] text-muted-foreground">{e.detail}</span> : null}
              </span>
            </div>
          ))
        ) : (
          <p className="py-2 text-[13px] text-muted-foreground">Nothing yet. Notes, emails, calls, and stage moves show here.</p>
        )}
      </div>
    </WorkCard>
  );
}

// ---------- Decision ----------

export function DecisionCard({ deal, advanceTo }: { deal: DealRow; advanceTo: Stage | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Not saved.");
      router.refresh();
    });
  if (deal.status !== "open") {
    return (
      <WorkCard title="Decision" hint="Recorded on the deal" testId="deal-decision">
        <div className="flex flex-wrap items-center gap-2 px-[22px] pt-3 pb-5">
          <Pill tone={deal.stageName === "Closed" ? "green" : "gray"} testId="decision-closed">
            {deal.stageName === "Passed" ? `Passed: ${deal.passReasonLabel ?? "no reason recorded"}` : deal.stageName === "Lost" ? "Lost" : "Closed"}
          </Pill>
          {deal.stageEnteredAt ? <span className="text-[13px] text-muted-foreground">{fmtDate(deal.stageEnteredAt, "MMM d, yyyy")}</span> : null}
        </div>
      </WorkCard>
    );
  }
  return (
    <WorkCard title="Decision" hint="Recorded on the deal, counts as progress either way" testId="deal-decision">
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          {advanceTo ? (
            <RowButton tone="gold" onClick={() => act(() => advanceDeal(deal.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="decision-advance">
              {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
            </RowButton>
          ) : null}
          <PassMenu label="Pass with a reason" onPick={(reason: PassReason) => act(() => passDeal(deal.id, reason))} pending={pending} testId="decision-pass" align="left" />
          <button type="button" onClick={() => act(() => markLost(deal.id))} disabled={pending} className="ml-1 text-xs text-muted-foreground hover:text-slate-800 hover:underline" data-testid="decision-lost">
            Lost (the seller withdrew or chose someone else)
          </button>
        </div>
        {error ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="decision-error">
            {error}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}
