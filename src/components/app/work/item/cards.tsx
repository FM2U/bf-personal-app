"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { addItemNote, addItemTask, advanceItem, closeItem, deleteItemTask, makeItemTaskNext, reopenItem, saveConsultingFacts, saveFindOut, saveItemNextAction, saveOpportunityFacts, setItemTaskDone, type ConsultingFactsInput, type OpportunityFactsInput } from "@/app/actions/pipelines";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { itemAsk } from "@/lib/work/ask-ai";
import { moneyShort } from "@/lib/work/buy-box";
import type { Stage } from "@/lib/work/data";
import { feeLabel } from "@/lib/work/pipelines";
import type { ItemRow } from "@/lib/work/pipelines-data";
import { dueLabel } from "@/lib/work/stages";
import type { TimelineEvent } from "@/lib/work/timeline";
import type { DealTodo } from "@/lib/work/todos";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { Fact, GrowingTextarea, SaveLine, useSave, useSynced } from "@/components/app/work/deal/cards";
import { ItemActionButtons } from "@/components/app/work/item-row";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { TasksCard } from "@/components/app/work/tasks-card";
import { TimelineEvents } from "@/components/app/work/timeline-list";
import { Pill, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the opportunity page (/work/jobs/[id]) and the consulting page (/work/consulting/[id]) under the
 * record-page rule (batch B2, approved 2026-10-31). Left: What to find out (opportunity; the type-specific card),
 * Next action (Save; Done, Later), Tasks. Right: Facts (Edit; the consulting facts hold the scope, fee, start date,
 * status), Timeline (notes, emails, calls, stage moves; Add a note below), Decision (Advance, Close: Declined, Not
 * chosen, Accepted; Lost, Done; Reopen). Each card saves through its own server action; the page re-reads.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

// ---------- Header ----------

export function ItemHeaderActions({ item, compose, advanceTo, closeTo, today, tz }: { item: ItemRow; compose: ComposeSetup | null; advanceTo: Stage | null; closeTo: { name: string; label: string; stageId: string }[]; today: string; tz: string }) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = item.status === "open";
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
        {compose ? (
          <RowButton onClick={() => setEmailOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="item-email">
            <Mail className="mr-1.5 h-3.5 w-3.5" /> {item.kind === "job" && item.contactName ? "Email the contact" : "Email"}
          </RowButton>
        ) : null}
        <RowButton onClick={() => setCallOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="item-log-call">
          <Phone className="mr-1.5 h-3.5 w-3.5" /> Log a call
        </RowButton>
        {open && advanceTo ? (
          <RowButton tone="cobalt" onClick={() => act(() => advanceItem(item.kind, item.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="item-advance">
            {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
          </RowButton>
        ) : null}
        {open ? <CloseMenu closeTo={closeTo} pending={pending} onPick={(name) => act(() => closeItem(item.kind, item.id, name))} testId="item-close" /> : null}
      </div>
      {error ? (
        <span className="text-[13px] text-status-missed" role="alert" data-testid="item-action-error">
          {error}
        </span>
      ) : null}
      {note ? (
        <span className="text-[13px] font-medium text-status-met" role="status" data-testid="item-logged">
          {note}
        </span>
      ) : null}
      {compose && emailOpen ? (
        <ComposeEmailDialog
          setup={compose}
          open={emailOpen}
          onOpenChange={setEmailOpen}
          ask={itemAsk(item)}
          onSent={() => {
            setNote("Email sent and logged on the timeline.");
            router.refresh();
          }}
        />
      ) : null}
      <LogCallDrawer
        target={{ contactId: item.contactId, dealId: item.id, who: item.contactName ?? "", from: `From ${item.name}`, currentDate: item.nextActionDue }}
        today={today}
        tz={tz}
        open={callOpen}
        onOpenChange={setCallOpen}
        onSaved={(r) => {
          setNote(`Call logged on the timeline, ${r.minutes} min.${r.nextAction ? ` Next action: ${r.nextAction}.` : ""}`);
          router.refresh();
        }}
      />
    </div>
  );
}

/** "Close" with the outcomes: Declined, Not chosen, Accepted (Job search); Lost, Done (Consulting). */
function CloseMenu({ closeTo, pending, onPick, testId, align = "right", className }: { closeTo: { name: string; label: string }[]; pending: boolean; onPick: (name: string) => void; testId: string; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const hint: Record<string, string> = { Declined: "Your decision", "Not chosen": "Their decision", Accepted: "You took the job", Lost: "They chose someone else or dropped it", Done: "Paid and wrapped up" };
  return (
    <div ref={ref} className="relative">
      <RowButton onClick={() => setOpen((o) => !o)} disabled={pending} aria-haspopup="menu" aria-expanded={open} className={cn("h-9 px-3.5 text-[13px]", className)} data-testid={testId}>
        Close
      </RowButton>
      {open ? (
        <div className={cn("absolute top-[calc(100%+4px)] z-20 flex min-w-[220px] flex-col rounded-[8px] border border-border bg-white p-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.12)]", align === "right" ? "right-0" : "left-0")} role="menu" data-testid={`${testId}-menu`}>
          {closeTo.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(c.name);
              }}
              className="flex flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-slate-50"
              data-testid={`${testId}-${c.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <span className="text-sm font-medium text-slate-900">{c.label}</span>
              {hint[c.name] ? <span className="text-xs text-muted-foreground">{hint[c.name]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Next action ----------

export function ItemNextActionCard({ item, today }: { item: ItemRow; today: string }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [action, setAction] = useSynced(item.nextAction ?? "");
  const [due, setDue] = useSynced(item.nextActionDue ?? "");
  const [minutes, setMinutes] = useSynced(item.nextActionMinutes ? String(item.nextActionMinutes) : "");
  const [waitingOn, setWaitingOn] = useSynced(item.waitingOn ?? "");
  const [since, setSince] = useSynced(item.waitingSince ?? today);
  const [focused, setFocused] = useState(false);
  const dirty = action !== (item.nextAction ?? "") || due !== (item.nextActionDue ?? "") || minutes !== (item.nextActionMinutes ? String(item.nextActionMinutes) : "") || waitingOn !== (item.waitingOn ?? "") || (waitingOn !== "" && since !== (item.waitingSince ?? today));
  useUnsavedWork(dirty, "The next action is not saved yet.");
  const d = item.nextAction ? dueLabel(item.nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  const hint = item.nextAction ? `Due ${d!.text.toLowerCase() === "today" ? "today" : d!.text}${item.nextActionMinutes ? ` · ${item.nextActionMinutes} min` : ""}` : "Needs a next action";
  return (
    <WorkCard
      id="next-action"
      title="Next action"
      actions={
        <>
          <span className="text-[13px] text-muted-foreground" data-testid="next-action-hint">{hint}</span>
          <AiCardStar context={{ ...itemAsk(item), card: "Next action" }} onUseNext={(x) => {
            setAction(x.action);
            setDue(x.due);
            setMinutes(x.minutes ? String(x.minutes) : "");
          }} testId="next-action-star" />
        </>
      }
      testId="item-next-action"
    >
      <div className={FORM} data-testid="next-action-form">
        <label htmlFor={`${ids}-a`} className={LABEL}>
          Action
        </label>
        <div className="relative min-w-0">
          <input id={`${ids}-a`} value={action} onChange={(e) => setAction(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder={item.kind === "job" ? "What you do next on this opportunity" : "What you do next for this client"} className={cn(INPUT, "pr-9")} data-testid="na-action" />
          <AiFieldStar context={itemAsk(item)} field={{ key: "next_action", label: "Next action", current: action }} visible={!action.trim() || focused} onUse={setAction} />
        </div>
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
            <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveItemNextAction(item.kind, item.id, { action, due, minutes, waitingOn, waitingSince: since }))} data-testid="na-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          ) : item.nextAction && item.status === "open" ? (
            <ItemActionButtons key={`${item.nextAction}|${item.stageName}|${item.nextActionDue}`} item={item} today={today} />
          ) : null}
        </SaveLine>
      </div>
    </WorkCard>
  );
}

// ---------- What to find out (opportunity) ----------

export function FindOutCard({ item }: { item: ItemRow }) {
  const { pending, state, run } = useSave();
  const [lines, setLines] = useState<string[]>(item.findOut);
  const [prev, setPrev] = useState(item.findOut);
  if (prev !== item.findOut) {
    setPrev(item.findOut);
    setLines(item.findOut);
  }
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const dirty = lines.length !== item.findOut.length || lines.some((l, i) => l !== item.findOut[i]);
  useUnsavedWork(dirty, "What to find out is not saved yet.");
  const ask = itemAsk(item);
  const add = () => {
    setLines((l) => [...l, ""]);
    setFocusLine(lines.length);
  };
  return (
    <WorkCard title="What to find out" hint="Edit any line" actions={<AiCardStar context={{ ...ask, card: "What to find out" }} />} testId="item-find-out">
      <div className="flex flex-col gap-1 px-[22px] pt-2 pb-4" data-testid="find-out-list">
        {lines.length ? (
          lines.map((line, i) => (
            <div key={i} className="relative flex items-start gap-1.5 border-t border-slate-100 py-0.5 first:border-t-0" data-testid="find-out-line">
              <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-status-neutral-solid" aria-hidden />
              <div className="relative min-w-0 flex-1">
                <GrowingTextarea
                  value={line}
                  onChange={(v) => setLines((l) => l.map((x, n) => (n === i ? v.replace(/\n/g, " ") : x)))}
                  minRows={1}
                  minHeight={30}
                  plain
                  autoFocus={focusLine === i}
                  onFocus={() => setFocusLine(i)}
                  onBlur={() => setFocusLine((f) => (f === i ? null : f))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                  placeholder="Type the question"
                  aria-label={`Line ${i + 1}`}
                  className="pr-7"
                  data-testid="find-out-input"
                />
                <AiFieldStar context={ask} field={{ key: "find_out", label: "What to find out", current: line, extra: lines.filter((x, n) => n !== i && x.trim()).length ? `Already listed: ${lines.filter((x, n) => n !== i && x.trim()).join("; ")}` : null }} visible={!line.trim() || focusLine === i} onUse={(t) => setLines((l) => l.map((x, n) => (n === i ? t : x)))} className="top-[15px]" />
              </div>
              <button type="button" onClick={() => setLines((l) => l.filter((_, n) => n !== i))} className="mt-1 h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="Delete this line" title="Delete" data-testid="find-out-delete">
                ×
              </button>
            </div>
          ))
        ) : (
          <p className="py-1.5 text-[12.5px] text-slate-400">Nothing yet. Add what you want to know before the next conversation.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5">
          <button type="button" onClick={add} className="text-xs font-medium text-primary-strong hover:underline" data-testid="find-out-add">
            + Add
          </button>
          <SaveLine state={dirty ? { kind: "idle" } : state}>
            {dirty ? (
              <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveFindOut(item.id, lines))} data-testid="find-out-save">
                {pending ? "Saving..." : "Save"}
              </RowButton>
            ) : null}
          </SaveLine>
        </div>
      </div>
    </WorkCard>
  );
}

// ---------- Tasks ----------

export function ItemTasksCard({ item, tasks }: { item: ItemRow; tasks: DealTodo[] }) {
  return (
    <TasksCard
      tasks={tasks}
      open={item.status === "open"}
      actions={{
        add: (text) => addItemTask(item.kind, item.id, text),
        setDone: (id, done) => setItemTaskDone(item.kind, id, done),
        remove: (id) => deleteItemTask(item.kind, id),
        makeNext: (id) => makeItemTaskNext(item.kind, id),
      }}
      placeholder={item.kind === "job" ? "Something else to do on this opportunity" : "Something else to do for this client"}
      emptyText="Nothing else yet. Add what else needs doing here."
      testId="item-tasks"
      ai={itemAsk(item)}
    />
  );
}

// ---------- Facts ----------

function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    return u.pathname && u.pathname !== "/" ? `${host}/...` : host;
  } catch {
    return url.slice(0, 30);
  }
}

export function OpportunityFactsCard({ item }: { item: ItemRow }) {
  const ids = useId();
  const { pending, state, run, reset } = useSave();
  const [editing, setEditing] = useState(false);
  const initial = (): OpportunityFactsInput => ({ company: item.name, role: item.title ?? "", contact: item.contactName ?? "", source: item.source ?? "", payRange: item.payRange ?? "", location: item.location ?? "", whatItDoes: item.whatItDoes ?? "", link: item.link ?? "" });
  const initialKey = JSON.stringify(initial());
  const [f, setF] = useState<OpportunityFactsInput>(initial);
  const [prevKey, setPrevKey] = useState(initialKey);
  if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    setF(initial());
  }
  const dirty = editing && JSON.stringify(f) !== initialKey;
  useUnsavedWork(dirty, "The facts are not saved yet.");
  const set = (k: keyof OpportunityFactsInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof OpportunityFactsInput, label: string, placeholder = "") => (
    <div key={k} className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      <input id={`${ids}-${k}`} value={f[k]} onChange={set(k)} placeholder={placeholder} className={INPUT} data-testid={`fact-${k}`} />
    </div>
  );
  const link = item.link ? (item.link.startsWith("http") ? item.link : `https://${item.link}`) : null;
  return (
    <WorkCard
      title="Facts"
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
      testId="item-facts"
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-2" data-testid="facts-form">
          {field("company", "Company")}
          {field("role", "Role")}
          {field("contact", "Contact", "Name, firm")}
          {field("source", "Source", "Recruiter, personal network, a posting")}
          {field("payRange", "Pay range", "$150K to $170K")}
          {field("location", "Location", "City, ST, on site or remote")}
          <div className="sm:col-span-2">{field("whatItDoes", "What the company does")}</div>
          <div className="sm:col-span-2">{field("link", "Link", "https://")}</div>
          <SaveLine state={state}>
            <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveOpportunityFacts(item.id, f), () => setEditing(false))} data-testid="facts-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          </SaveLine>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5" data-testid="facts-grid">
          <Fact label="Company">{item.name}</Fact>
          <Fact label="Role" testId="fact-role">
            {item.title ?? "Not set"}
          </Fact>
          <Fact label="Contact">{item.contactName ?? "Not set"}</Fact>
          <Fact label="Source">{item.source ?? "Not set"}</Fact>
          <Fact label="Pay range" testId="fact-pay">
            {item.payRange ?? "Not known"}
          </Fact>
          <Fact label="Location">{item.location ?? "Not set"}</Fact>
          <Fact label="Link">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" title={link} className="block truncate text-primary-strong hover:underline" data-testid="fact-link">
                {linkLabel(link)}
              </a>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Opened">{item.createdAt ? fmtDate(item.createdAt, "MMM d") : "Not known"}</Fact>
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

export function ConsultingFactsCard({ item }: { item: ItemRow }) {
  const ids = useId();
  const { pending, state, run, reset } = useSave();
  const [editing, setEditing] = useState(false);
  const initial = (): ConsultingFactsInput => ({ client: item.name, project: item.title ?? "", contact: item.contactName ?? "", fee: item.fee === null ? "" : moneyShort(item.fee), scope: item.scope ?? "", startDate: item.startDate ?? "" });
  const initialKey = JSON.stringify(initial());
  const [f, setF] = useState<ConsultingFactsInput>(initial);
  const [prevKey, setPrevKey] = useState(initialKey);
  if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    setF(initial());
  }
  const dirty = editing && JSON.stringify(f) !== initialKey;
  useUnsavedWork(dirty, "The facts are not saved yet.");
  const set = (k: keyof ConsultingFactsInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof ConsultingFactsInput, label: string, placeholder = "", type = "text") => (
    <div key={k} className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      <input id={`${ids}-${k}`} type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} className={cn(INPUT, type === "date" && "w-auto")} data-testid={`fact-${k}`} />
    </div>
  );
  const status = item.status !== "open" ? item.stageName ?? "Closed" : item.nextAction ? `${item.stageName}; ${item.nextAction.charAt(0).toLowerCase()}${item.nextAction.slice(1)}${item.nextActionDue ? ` due ${fmtDate(item.nextActionDue, "MMM d")}` : ""}` : `${item.stageName}; needs a next action`;
  return (
    <WorkCard
      title="Facts"
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
      testId="item-facts"
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-2" data-testid="facts-form">
          {field("client", "Client")}
          {field("project", "Project")}
          {field("contact", "Contact", "Name, title")}
          {field("fee", "Fee", "$18K")}
          <div className="sm:col-span-2">{field("scope", "Scope")}</div>
          {field("startDate", "Start date", "", "date")}
          <SaveLine state={state}>
            <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveConsultingFacts(item.id, f), () => setEditing(false))} data-testid="facts-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          </SaveLine>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5" data-testid="facts-grid">
          <Fact label="Client">{item.name}</Fact>
          <Fact label="Contact">{item.contactName ?? "Not set"}</Fact>
          <div className="col-span-2">
            <Fact label="Scope" testId="fact-scope">
              {item.scope ?? "Not set"}
            </Fact>
          </div>
          <Fact label="Fee" testId="fact-fee">
            {feeLabel(item.fee, item.stageName)}
          </Fact>
          <Fact label="Start date">{item.startDate ? fmtDate(item.startDate, "MMM d") : "Not set"}</Fact>
          <Fact label="Status" testId="fact-status">
            {status}
          </Fact>
          <Fact label="Opened">{item.createdAt ? fmtDate(item.createdAt, "MMM d") : "Not known"}</Fact>
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

export function ItemTimelineCard({ item, events }: { item: ItemRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  return (
    <WorkCard title="Timeline" hint="Newest first" testId="item-timeline">
      <TimelineEvents events={events} empty="Nothing yet. Notes, emails, calls, and stage moves show here." />
      <div className="flex flex-col gap-2 px-[22px] pt-2 pb-4" data-testid="note-form">
        <div className="flex items-start gap-2">
          <GrowingTextarea id="item-note" value={note} onChange={setNote} minRows={1} placeholder="Add a note" className="flex-1" data-testid="item-note" />
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addItemNote(item.kind, item.id, note), () => setNote(""))} className="h-9 shrink-0" data-testid="note-save">
            {pending ? "Saving..." : "Add"}
          </RowButton>
        </div>
        {state.kind === "error" ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="save-error">
            {state.text}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Decision ----------

export function ItemDecisionCard({ item, advanceTo, closeTo }: { item: ItemRow; advanceTo: Stage | null; closeTo: { name: string; label: string; stageId: string }[] }) {
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
  if (item.status !== "open") {
    return (
      <WorkCard title="Decision" hint="Recorded; Reopen puts it back at the first stage" testId="item-decision">
        <div className="flex flex-wrap items-center gap-2 px-[22px] pt-3 pb-5">
          <Pill tone={item.status === "won" ? "green" : "charcoal"} testId="decision-closed">
            {item.stageName ?? "Closed"}
          </Pill>
          {item.stageEnteredAt ? <span className="text-[13px] text-muted-foreground">{fmtDate(item.stageEnteredAt, "MMM d, yyyy")}</span> : null}
          <RowButton onClick={() => act(() => reopenItem(item.kind, item.id))} disabled={pending} className="ml-1" data-testid="decision-reopen">
            Reopen
          </RowButton>
        </div>
      </WorkCard>
    );
  }
  const hint = item.kind === "job" ? (advanceTo ? `${advanceTo.name} once they move you on` : "Decide on the offer") : advanceTo ? `${advanceTo.name} once the client says yes` : "Done once paid and wrapped up";
  return (
    <WorkCard title="Decision" hint={hint} testId="item-decision">
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          {advanceTo ? (
            <RowButton tone="cobalt" onClick={() => act(() => advanceItem(item.kind, item.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="decision-advance">
              {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
            </RowButton>
          ) : null}
          <CloseMenu closeTo={closeTo} pending={pending} onPick={(name) => act(() => closeItem(item.kind, item.id, name))} testId="decision-close" align="left" />
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
