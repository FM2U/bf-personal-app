"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { addDealNote, addTodo, advanceDeal, deleteTodo, makeTodoNextAction, markLost, passDeal, saveFacts, saveFindings, saveNextAction, setTodoDone, suggestQuestions, suggestTodos, type FactsInput } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { dealAsk } from "@/lib/work/ask-ai";
import { LISTING_SOURCES, moneyShort, type PassReason } from "@/lib/work/buy-box";
import type { DealRow, Stage, TimelineEvent } from "@/lib/work/data";
import { QUESTION_GROUPS, questionsEmailDraft, type QuestionGroupKey, type QuestionGroups } from "@/lib/work/questions";
import { dueLabel } from "@/lib/work/stages";
import type { DealTodo } from "@/lib/work/todos";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { TasksCard } from "@/components/app/work/tasks-card";
import { TimelineEvents } from "@/components/app/work/timeline-list";
import { PassMenu } from "@/components/app/work/listing-row";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { AiButton, Pill, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the deal page (/work/deals/[id]). Each card saves through its own server action and shows "Saved" or
 * the error next to its button; typed text stays in place either way. The page re-reads after a successful save.
 * Edit batch A (2026-10-31): the key finding grows with its text, the open questions are an outline in three groups
 * (filled by the AI, every line editable, Suggest questions, Email these questions), the Tasks checklist (was Also
 * to do; batch B's shared TasksCard), the two name fields in Facts, Add a note under the timeline, and Log a call.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

/** A text box that grows with its text (several lines, nothing cut off). */
export function GrowingTextarea({ value, onChange, minRows = 2, minHeight, plain = false, className, ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; minRows?: number; minHeight?: number; /** No box until it is hovered or focused (the open question lines). */ plain?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, minHeight ?? minRows * 22 + 16)}px`;
  }, [value, minRows, minHeight]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      className={cn(
        plain ? "w-full min-w-0 rounded-[6px] border border-transparent bg-transparent px-1.5 py-1 text-sm leading-[22px] text-slate-800 hover:border-slate-200 focus-visible:border-input focus-visible:bg-white focus-visible:outline-none" : cn(INPUT, "py-2 leading-[22px]"),
        "h-auto resize-none overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SaveLine({ state, children }: { state: { kind: "idle" } | { kind: "saved" } | { kind: "error"; text: string }; children: React.ReactNode }) {
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
export function useSynced<T>(value: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setState(value);
  }
  return [state, setState];
}

export function useSave() {
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

export function DealHeaderActions({ deal, compose, advanceTo, today, tz }: { deal: DealRow; compose: ComposeSetup | null; advanceTo: Stage | null; today: string; tz: string }) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [callNote, setCallNote] = useState<string | null>(null);
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
        <RowButton onClick={() => setCallOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="deal-log-call">
          <Phone className="mr-1.5 h-3.5 w-3.5" /> Log a call
        </RowButton>
        {open && advanceTo ? (
          <RowButton tone="cobalt" onClick={() => act(() => advanceDeal(deal.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="deal-advance">
            {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
          </RowButton>
        ) : null}
        {open ? <PassMenu onPick={(reason: PassReason) => act(() => passDeal(deal.id, reason))} pending={pending} testId="deal-pass" className="h-9 px-3.5 text-[13px]" /> : null}
      </div>
      {error ? (
        <span className="text-[13px] text-status-missed" role="alert" data-testid="deal-action-error">
          {error}
        </span>
      ) : null}
      {callNote ? (
        <span className="text-[13px] font-medium text-status-met" role="status" data-testid="deal-call-logged">
          {callNote}
        </span>
      ) : null}
      {compose && emailOpen ? <ComposeEmailDialog setup={compose} open={emailOpen} onOpenChange={setEmailOpen} ask={dealAsk(deal)} /> : null}
      <LogCallDrawer
        target={{ contactId: deal.contactId, dealId: deal.id, who: deal.contactName ?? deal.brokerName ?? "", from: `From ${deal.name}`, currentDate: deal.nextActionDue }}
        today={today}
        tz={tz}
        open={callOpen}
        onOpenChange={setCallOpen}
        onSaved={(r) => {
          setCallNote(`Call logged on the timeline, ${r.minutes} min.${r.nextAction ? ` Next action: ${r.nextAction}.` : ""}`);
          router.refresh();
        }}
      />
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
  const [focused, setFocused] = useState(false);
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
        <div className="relative min-w-0">
          <input id={`${ids}-a`} value={action} onChange={(e) => setAction(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="What you do next on this deal" className={cn(INPUT, "pr-9")} data-testid="na-action" />
          <AiFieldStar context={dealAsk(deal)} field={{ key: "next_action", label: "Next action", current: action }} visible={!action.trim() || focused} onUse={setAction} />
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

const sameQuestions = (a: QuestionGroups, b: QuestionGroups) => QUESTION_GROUPS.every((g) => a[g.key].length === b[g.key].length && a[g.key].every((l, i) => l === b[g.key][i]));

/**
 * Findings: the key finding (a full-width box that grows with its text) and the open questions as an outline in
 * three groups, Ask the seller, Ask the broker, Find out myself. Every line is a text box (edit it, or clear it and
 * press the faint x to delete it); "+ Add" adds a line to a group. "Suggest questions" asks the AI for more (the
 * new lines are added to the groups); "Email these questions" opens the email editor to the broker (the seller
 * selectable when known) with the seller and broker groups as bullets. Save keeps the key finding and the lines.
 */
export function FindingsCard({ deal, compose }: { deal: DealRow; compose: ComposeSetup | null }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [key, setKey] = useSynced(deal.keyFinding ?? "");
  // The lines on screen, and the saved lines they are compared with (Suggest questions saves on the server and moves
  // the baseline, so typed lines stay and nothing counts as unsaved that is not).
  const [questions, setQuestions] = useState<QuestionGroups>(deal.openQuestions);
  const [baseline, setBaseline] = useState<QuestionGroups>(deal.openQuestions);
  const [prevProp, setPrevProp] = useState(deal.openQuestions);
  if (prevProp !== deal.openQuestions) {
    setPrevProp(deal.openQuestions);
    setBaseline(deal.openQuestions);
    setQuestions(deal.openQuestions);
  }
  const [suggesting, startSuggest] = useTransition();
  const [suggestNote, setSuggestNote] = useState<{ tone: "ok" | "warn"; text: string; reply?: string | null } | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const [keyFocused, setKeyFocused] = useState(false);
  const dirty = key !== (deal.keyFinding ?? "") || !sameQuestions(questions, baseline);
  useUnsavedWork(dirty, "The findings are not saved yet.");

  const setLine = (g: QuestionGroupKey, i: number, text: string) => setQuestions((q) => ({ ...q, [g]: q[g].map((l, n) => (n === i ? text : l)) }));
  const removeLine = (g: QuestionGroupKey, i: number) => setQuestions((q) => ({ ...q, [g]: q[g].filter((_, n) => n !== i) }));
  const addLine = (g: QuestionGroupKey) => {
    setQuestions((q) => ({ ...q, [g]: [...q[g], ""] }));
    setFocusLine(`${g}-${questions[g].length}`);
  };
  const suggest = () => {
    setSuggestNote(null);
    startSuggest(async () => {
      const r = await suggestQuestions(deal.id);
      if (!r.ok) return setSuggestNote({ tone: "warn", text: r.error, reply: r.reply });
      // Lines typed here and not saved yet stay; the AI's new lines (saved on the deal already) join them.
      setBaseline(r.questions);
      setQuestions((q) => {
        const next = { ...q };
        for (const g of QUESTION_GROUPS) {
          const have = new Set(q[g.key].map((l) => l.trim().toLowerCase()));
          next[g.key] = [...q[g.key], ...r.questions[g.key].filter((l) => !have.has(l.toLowerCase()))];
        }
        return next;
      });
      setSuggestNote({ tone: "ok", text: r.added ? `${r.added} suggested. Edit or delete any.` : "Nothing new to add." });
    });
  };
  const draft = questionsEmailDraft({ dealName: deal.name, toName: compose?.recipients.find((r) => r.email === compose.defaultTo)?.name ?? null, questions });
  const emailable = questions.seller.some((l) => l.trim()) || questions.broker.some((l) => l.trim());
  return (
    <WorkCard title="Findings" actions={<AiCardStar context={{ ...dealAsk(deal), card: "Open questions" }} />} testId="deal-findings">
      <div className="flex flex-col gap-2.5 px-[22px] pt-3 pb-5" data-testid="findings-form">
        <label htmlFor={`${ids}-k`} className={LABEL}>
          Key finding
        </label>
        <div className="relative min-w-0">
          <GrowingTextarea id={`${ids}-k`} value={key} onChange={setKey} onFocus={() => setKeyFocused(true)} onBlur={() => setKeyFocused(false)} placeholder="The one line that matters most" className="pr-9" data-testid="key-finding" />
          <AiFieldStar context={dealAsk(deal)} field={{ key: "key_finding", label: "Key finding", current: key }} visible={!key.trim() || keyFocused} onUse={setKey} className="top-[18px]" />
        </div>
        <div className={cn(LABEL, "pt-1")}>Open questions</div>
        <div className="flex flex-col gap-1" data-testid="open-questions">
          {QUESTION_GROUPS.map((g) => (
            <div key={g.key} className="flex flex-col" data-testid="question-group" data-group={g.key} data-count={questions[g.key].filter((l) => l.trim()).length}>
              <div className="flex items-center justify-between gap-2 pt-1.5 pb-1">
                <span className="text-[13px] font-semibold text-slate-900">{g.label}</span>
                <button type="button" onClick={() => addLine(g.key)} className="text-xs font-medium text-primary-strong hover:underline" data-testid={`question-add-${g.key}`}>
                  + Add
                </button>
              </div>
              {questions[g.key].length ? (
                questions[g.key].map((line, i) => (
                  <div key={`${g.key}-${i}`} className="flex items-start gap-1.5 border-t border-slate-100 py-0.5" data-testid="question-line">
                    <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-status-neutral-solid" aria-hidden />
                    <GrowingTextarea
                      value={line}
                      onChange={(v) => setLine(g.key, i, v.replace(/\n/g, " "))}
                      minRows={1}
                      minHeight={30}
                      plain
                      autoFocus={focusLine === `${g.key}-${i}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addLine(g.key);
                        }
                      }}
                      placeholder="Type the question"
                      aria-label={`${g.label}, line ${i + 1}`}
                      className="flex-1"
                      data-testid="question-input"
                    />
                    <button type="button" onClick={() => removeLine(g.key, i)} className="mt-1 h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="Delete this question" title="Delete" data-testid="question-delete">
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="border-t border-slate-100 py-1.5 text-[12.5px] text-slate-400">None yet.</p>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Filled by the AI when a listing becomes Interested. Edit anything.</p>
        <div className="flex flex-wrap items-center gap-2">
          <AiButton busy={suggesting} onClick={suggest} disabled={pending} data-testid="suggest-questions">
            Suggest questions
          </AiButton>
          {compose ? (
            <RowButton onClick={() => setEmailOpen(true)} disabled={!emailable} title={emailable ? undefined : "Add a seller or broker question first"} data-testid="email-questions">
              <Mail className="mr-1.5 h-3.5 w-3.5" /> Email these questions
            </RowButton>
          ) : null}
          {suggestNote ? (
            <span className={cn("text-[13px]", suggestNote.tone === "ok" ? "text-status-met" : "text-status-missed")} role="status" data-testid="suggest-note">
              {suggestNote.text}
              {suggestNote.reply ? (
                <>
                  {" "}
                  Its reply: <q className="text-slate-700 italic" data-testid="suggest-note-reply">{suggestNote.reply}</q>
                </>
              ) : null}
              {suggestNote.tone === "warn" ? (
                <>
                  {" "}
                  <button type="button" onClick={suggest} className="font-medium text-primary-strong hover:underline" data-testid="suggest-note-retry">
                    Try again
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveFindings(deal.id, { keyFinding: key, questions }))} data-testid="findings-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </SaveLine>
      </div>
      {compose && emailOpen ? <ComposeEmailDialog setup={compose} open={emailOpen} onOpenChange={setEmailOpen} initial={draft} ask={dealAsk(deal)} /> : null}
    </WorkCard>
  );
}

// ---------- Tasks (was Also to do) ----------

/** Tasks on a deal: the shared card wired to the deal actions (add, done, delete, Make this the next action, Suggest). */
export function TodosCard({ deal, todos }: { deal: DealRow; todos: DealTodo[] }) {
  return (
    <TasksCard
      tasks={todos}
      open={deal.status === "open"}
      actions={{
        add: (text) => addTodo(deal.id, text),
        setDone: (id, done) => setTodoDone(id, done),
        remove: (id) => deleteTodo(id),
        makeNext: (id) => makeTodoNextAction(id),
        suggest: () => suggestTodos(deal.id),
      }}
      placeholder="Something else to do on this deal"
      emptyText="Nothing else yet. Add what else needs doing on this deal, or let the AI suggest a few."
      testId="deal-todos"
      ai={dealAsk(deal)}
    />
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

export function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <span className="label-caps">{label}</span>
      <b className="min-w-0 text-sm font-medium break-words text-slate-900">{children}</b>
    </div>
  );
}

export function FactsCard({ deal }: { deal: DealRow }) {
  const ids = useId();
  const { pending, state, run, reset } = useSave();
  const [editing, setEditing] = useState(false);
  const initial = (): FactsInput => ({
    name: deal.listingName,
    companyName: deal.companyName ?? "",
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
          {field("name", "Listing name", "00 Industrial Filtration Distributor")}
          {field("companyName", "Company name (when known)", "Shown everywhere once set")}
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

export function TimelineCard({ deal, events }: { deal: DealRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  return (
    <WorkCard title="Timeline" hint="Newest first" testId="deal-timeline">
      <TimelineEvents events={events} empty="Nothing yet. Notes, emails, calls, and stage moves show here." />
      <div className="flex flex-col gap-2 px-[22px] pt-2 pb-4" data-testid="note-form">
        <div className="flex items-start gap-2">
          <GrowingTextarea id="deal-note" value={note} onChange={setNote} minRows={1} placeholder="Add a note: what you learned, who said what" className="flex-1" data-testid="deal-note" />
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addDealNote(deal.id, note), () => setNote(""))} className="h-9 shrink-0" data-testid="note-save">
            {pending ? "Saving..." : "Add note"}
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
          <Pill tone={deal.stageName === "Closed" ? "green" : "charcoal"} testId="decision-closed">
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
            <RowButton tone="cobalt" onClick={() => act(() => advanceDeal(deal.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="decision-advance">
              {pending ? "Moving..." : `Advance to ${advanceTo.name}`}
            </RowButton>
          ) : null}
          <PassMenu label="Pass with a reason" onPick={(reason: PassReason) => act(() => passDeal(deal.id, reason))} pending={pending} testId="decision-pass" align="left" className="h-9 px-3.5 text-[13px]" />
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
