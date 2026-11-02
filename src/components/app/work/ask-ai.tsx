"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { addTaskFromAi, askAboutPage, askAiSetup, draftField, draftKeyFinding, setNextActionFromAi, setNextActionFromAnswer, suggestNextAction, suggestNextSteps, suggestQuestionsFromAi, suggestTasks, type AskSetup } from "@/app/actions/ask-ai";
import { draftReasons } from "@/app/actions/accountability";
import type { ReasonDraft } from "@/lib/accountability/ask-ai";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { panelSpec, setNextActionLabel, type Answer, type AskContext, type AskField, type KeyFindingDraft, type NextActionSuggestion, type NextStep } from "@/lib/work/ask-ai";
import { date as fmtDate } from "@/lib/format";
import { Drawer } from "@/components/app/work/drawer";
import { AiButton, ROW_BUTTON_BASE, ROW_BUTTON_TONE, RowButton, Thinking } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Ask AI element (approved 2026-10-31, decisions on v2 and v3; the panel built in batch B2; Edit batch B, item
 * 3, 2026-11-01). Three levels: the page pill (a pill like the filter pills, a little taller, with the small purple
 * four-point star; the panel reads the page), the purple star at the right of a card header (the panel is about that
 * card), and the star inside a field (visible only while the field is empty or being edited; the panel writes the
 * field and "Use this" fills it). The purple star is the one mark that means AI; the card and field stars sit in a
 * faint purple circle. The panel (a right-side drawer, about 480px, 28px gutters) opens at once with its title, its
 * three suggested questions, and its sections (panelSpec, in the browser); the ready state and the suggestions load
 * into it (Edit batch C: no cost line; a quiet amber line only when the month's spend is within 10% of the cap). Opened from a card or a field the whole panel is about that thing: "Ask AI about Tasks" with questions
 * about the tasks and "Suggest tasks for this deal" (Add as a task); "Ask AI about the Key finding field" with the
 * draft and questions about the field. The page-level questions and next steps show only from the page pill.
 * Everything AI-related is purple; every AI button shares the one thinking state (grayed, a spinner, "Thinking").
 */
export function AiStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-[13px] w-[13px] shrink-0 text-violet", className)} aria-hidden>
      <path d="M8 0.5 C8.6 4.4 9.9 6.4 15.5 8 C9.9 9.6 8.6 11.6 8 15.5 C7.4 11.6 6.1 9.6 0.5 8 C6.1 6.4 7.4 4.4 8 0.5 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The End of day drafts (batch C): "Draft the reasons for the missed commitments" with Use these, "Write tomorrow's
 * line" with Use this line, "Make the report shorter" with Use the short version. The page pill, the card stars, and
 * the matching suggested questions all lead here.
 */
export type EodExtras = {
  day: string;
  /** "Use these": fills the reason boxes. */
  onUseReasons?: (drafts: ReasonDraft[]) => void;
  /** "Use this line": fills the tomorrow box. */
  onUseTomorrow?: (text: string) => void;
  /** "Use the short version": the short report goes into the preview. */
  onUseShort?: () => Promise<string | null> | void;
  /** The tomorrow field's current text (for the draft). */
  tomorrow?: string;
  /** No draft can be used once the day is sent or skipped. */
  closed?: "sent" | "skipped" | null;
};

export type AskAiProps = {
  context: AskContext;
  /** The email setup for "Open in email" (record pages with a contact; Home with a typed address). */
  compose?: ComposeSetup | null;
  /** The End of day drafts (batch C). */
  extras?: EodExtras | null;
  /** The next action star (Edit batch C round 2): "Use this" fills the card's action (or what for), due date, and minutes. */
  onUseNext?: ((s: NextActionSuggestion) => void) | null;
};

/** The page-level pill in every Work page header. */
export function AskAiPill({ context, compose, extras, className }: AskAiProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-white px-3.5 text-[13px] font-medium whitespace-nowrap text-slate-800 hover:bg-slate-50", className)} data-testid="ask-ai">
        <AiStar />
        Ask AI
      </button>
      {open ? <AskAiPanel context={context} compose={compose} extras={extras} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/** The faint circle behind the card and field stars (the AI's soft purple with its rule as the edge). */
const STAR_CIRCLE = "inline-flex shrink-0 items-center justify-center rounded-full border border-violet-rule bg-violet-soft hover:border-violet/40 hover:bg-[#f3ecff]";

/** The purple star at the right of a card header (21px, in a 34px faint circle; hover shows "Ask AI"); opens the panel about that card. */
export function AiCardStar({ context, compose, extras, onUseNext, className, testId = "ai-card-star" }: AskAiProps & { className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Ask AI" aria-label={`Ask AI about ${context.card ?? context.label}`} className={cn(STAR_CIRCLE, "h-[34px] w-[34px]", className)} data-testid={testId} data-card={context.card ?? undefined}>
        <AiStar className="h-[21px] w-[21px]" />
      </button>
      {open ? <AskAiPanel context={context} compose={compose} extras={extras} open={open} onOpenChange={setOpen} onUseNext={onUseNext ? (x) => { onUseNext(x); setOpen(false); } : null} /> : null}
    </>
  );
}

/**
 * The star inside a field (20px, in a 28px faint circle): shown while the field is empty or focused. Wrap the input
 * in a `relative` box and give the input right padding (pr-9). `onUse` fills the field with the AI's text.
 */
export function AiFieldStar({ context, field, visible, onUse, onUseFindings, className, testId = "ai-field-star" }: { context: Omit<AskContext, "field">; field: AskField; visible: boolean; onUse: (text: string) => void; /** The Key finding star (AI instructions, 2026-11-02): "Use this" fills the Key finding, Strengths, Risks, and the broker questions. */ onUseFindings?: ((d: KeyFindingDraft) => void) | null; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        title="Ask AI"
        aria-label={`Ask AI to write ${field.label}`}
        className={cn("absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2", STAR_CIRCLE, !visible && "hidden", className)}
        data-testid={testId}
        data-field={field.key}
      >
        <AiStar className="h-5 w-5" />
      </button>
      {open ? <AskAiPanel context={{ ...context, card: null, field }} open={open} onOpenChange={setOpen} onUse={(t) => { onUse(t); setOpen(false); }} onUseFindings={onUseFindings ? (d) => { onUseFindings(d); setOpen(false); } : null} /> : null}
    </>
  );
}

/** A bullet from the AI: "**Lead-in:** the point" shows the lead-in in bold; anything else as typed. */
function Bullet({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  if (parts.length < 3) return <>{text.replace(/\*\*/g, "")}</>;
  return <>{parts.map((p, i) => (i % 2 === 1 ? <b key={i} className="font-semibold">{p}</b> : <span key={i}>{p}</span>))}</>;
}

/** A small purple section heading inside the panel. */
function PanelHeading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-rule pb-2">
      <h3 className="text-[11.5px] font-semibold tracking-[0.09em] text-violet uppercase">{children}</h3>
      {right}
    </div>
  );
}

/**
 * The line under an AI call that could not be used: the message, the AI's reply (first 300 characters) when the
 * app has it, and Try again.
 */
function AiFailLine({ error, reply, onRetry, testId, className }: { error: string; reply?: string | null; onRetry: () => void; testId: string; className?: string }) {
  return (
    <p className={cn("text-[13px] text-status-missed", className)} role="alert" data-testid={testId}>
      {error}
      {reply ? (
        <>
          {" "}
          Its reply: <q className="text-slate-700 italic" data-testid={`${testId}-reply`}>{reply}</q>
        </>
      ) : null}{" "}
      <button type="button" onClick={onRetry} className="font-medium text-primary-strong hover:underline" data-testid={`${testId}-retry`}>
        Try again
      </button>
    </p>
  );
}

type FailState = { error: string; reply?: string | null } | null;

/**
 * The Key finding draft in the panel (AI instructions, 2026-11-02): the Key finding, Strengths, Risks, and Check with
 * the broker, each under a small label, and "Use this", which fills the Findings card (Key finding, Strengths, Risks;
 * the questions are added under Ask the broker). Nothing is saved until the card's Save.
 */
function KeyFindingDraftView({ draft, onUse }: { draft: KeyFindingDraft; onUse: () => void }) {
  const list = (label: string, items: string[], testId: string) => (
    <div className="border-t border-violet-rule pt-2.5" data-testid={testId} data-count={items.length}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {items.length ? (
        <ul className="mt-1 flex flex-col gap-1 pl-4 text-sm text-slate-800">
          {items.map((x, i) => (
            <li key={i} className="list-disc">
              {x}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-slate-400">None.</p>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-key-finding">
      <div>
        <span className="block text-xs font-medium text-muted-foreground">Key finding</span>
        <p className="mt-1 text-sm font-medium text-slate-900" data-testid="ask-ai-kf-text">
          {draft.keyFinding}
        </p>
      </div>
      {list("Strengths", draft.strengths, "ask-ai-kf-strengths")}
      {list("Risks", draft.risks, "ask-ai-kf-risks")}
      {list("Check with the broker", draft.brokerQuestions, "ask-ai-kf-broker")}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onUse} className={VIOLET_BUTTON} data-testid="ask-ai-use-findings">
          Use this
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground">Use this fills the Findings card and adds the broker questions under Ask the broker. Nothing is saved until you press Save.</p>
    </div>
  );
}

const VIOLET_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet bg-white px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-violet-soft disabled:pointer-events-none disabled:opacity-50";
const SOFT_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet-rule bg-violet-soft px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-[#f3ecff] disabled:pointer-events-none disabled:opacity-50";
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function AskAiPanel({ context, compose, extras, open, onOpenChange, onUse, onUseNext, onUseFindings }: { context: AskContext; compose?: ComposeSetup | null; extras?: EodExtras | null; open: boolean; onOpenChange: (open: boolean) => void; /** A field star: "Use this" fills the field. */ onUse?: (text: string) => void; /** The next action star: "Use this" fills the card's fields. */ onUseNext?: ((s: NextActionSuggestion) => void) | null; /** The Key finding star: "Use this" fills the Findings card (nothing saved until its Save). */ onUseFindings?: ((d: KeyFindingDraft) => void) | null }) {
  const router = useRouter();
  const spec = panelSpec(context);
  // The End of day drafts (batch C): which of the three the panel shows, by the card it was opened from (all three from the page pill).
  const eod = extras && !context.field ? extras : null;
  const showReasons = !!eod?.onUseReasons && (!context.card || context.card === "Reasons");
  const showTomorrow = !!eod?.onUseTomorrow && (!context.card || context.card === "What matters tomorrow");
  const showShort = !!eod?.onUseShort && (!context.card || context.card === "Report");
  const [reasons, setReasons] = useState<ReasonDraft[] | null>(null);
  const [reasonsError, setReasonsError] = useState<FailState>(null);
  const [reasonsBusy, setReasonsBusy] = useState(false);
  const [reasonsNote, setReasonsNote] = useState<string | null>(null);
  const [tomorrowDraft, setTomorrowDraft] = useState<string | null>(null);
  const [tomorrowError, setTomorrowError] = useState<FailState>(null);
  const [tomorrowBusy, setTomorrowBusy] = useState(false);
  const [tomorrowNote, setTomorrowNote] = useState<string | null>(null);
  const [shortNote, setShortNote] = useState<string | null>(null);
  const [shortBusy, setShortBusy] = useState(false);
  const closedWord = eod?.closed ? `Today is already ${eod.closed}.` : null;
  const loadReasons = async () => {
    if (!eod) return;
    setReasons(null);
    setReasonsError(null);
    setReasonsNote(null);
    setReasonsBusy(true);
    const r = await draftReasons(eod.day);
    setReasonsBusy(false);
    if (!r.ok) return setReasonsError({ error: r.error, reply: r.reply });
    setReasons(r.drafts);
  };
  const loadTomorrow = async () => {
    if (!eod) return;
    setTomorrowDraft(null);
    setTomorrowError(null);
    setTomorrowNote(null);
    setTomorrowBusy(true);
    const r = await draftField({ ...context, card: null, field: { key: "tomorrow_line", label: "What matters tomorrow", current: eod.tomorrow ?? null } });
    setTomorrowBusy(false);
    if (!r.ok) return setTomorrowError({ error: r.error, reply: r.reply });
    setTomorrowDraft(r.text);
  };
  const applyShort = async () => {
    if (!eod?.onUseShort) return;
    setShortBusy(true);
    const r = await eod.onUseShort();
    setShortBusy(false);
    setShortNote(r === null ? "The short version could not be made." : "In the preview. Edit still works on it.");
  };
  const [setup, setSetup] = useState<AskSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [steps, setSteps] = useState<NextStep[] | null>(null);
  const [nextSuggestion, setNextSuggestion] = useState<NextActionSuggestion | null>(null);
  const [stepsError, setStepsError] = useState<FailState>(null);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsNote, setStepsNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerError, setAnswerError] = useState<FailState>(null);
  const [asking, startAsk] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [findings, setFindings] = useState<KeyFindingDraft | null>(null);
  const [answerNote, setAnswerNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [draftError, setDraftError] = useState<FailState>(null);
  const [drafting, startDraft] = useTransition();
  const [setting, startSet] = useTransition();
  const [setNote, setSetNote] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const loaded = useRef(false);
  const field = context.field ?? null;
  // AI instructions (2026-11-02): the Key finding star writes Strengths, Risks, the Key finding, and Check with the broker.
  const keyFindingStar = field?.key === "key_finding" && !!onUseFindings;
  const suggest = spec.suggest;

  /** The suggestions of this panel: next steps, tasks, or questions (the last adds to the deal and reports the count). */
  const loadSuggestions = async () => {
    if (!suggest) return;
    setSteps(null);
    setNextSuggestion(null);
    setStepsError(null);
    setStepsNote(null);
    setStepsLoading(true);
    if (suggest.kind === "next_action") {
      const r = await suggestNextAction(context);
      setStepsLoading(false);
      if (!r.ok) return setStepsError({ error: r.error, reply: r.reply });
      setNextSuggestion(r.suggestion);
      return;
    }
    if (suggest.kind === "questions") {
      const r = await suggestQuestionsFromAi(context);
      setStepsLoading(false);
      if (!r.ok) return setStepsError({ error: r.error, reply: r.reply });
      setStepsNote(r.added ? `${r.added} added to the deal's open questions. Edit or delete any on the Findings card.` : "Nothing new to add.");
      router.refresh();
      return;
    }
    const r = suggest.kind === "tasks" ? await suggestTasks(context) : await suggestNextSteps(context);
    setStepsLoading(false);
    if (!r.ok) return setStepsError({ error: r.error, reply: r.reply });
    setSteps(r.steps);
  };

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    let alive = true;
    (async () => {
      const r = await askAiSetup(context);
      if (!alive) return;
      if (!r.ok) return setSetupError(r.error);
      setSetup(r);
      // The suggestions load on their own (the AI acts without being asked where it is cheap), except questions,
      // which change the deal and wait for the button.
      if (suggest && suggest.kind !== "questions" && r.ready) await loadSuggestions();
      if (field && r.ready) writeField();
      // The End of day drafts load on their own when the panel is about one card (the page pill waits for a pill).
      if (r.ready && context.card === "Reasons" && showReasons) await loadReasons();
      if (r.ready && context.card === "What matters tomorrow" && showTomorrow) await loadTomorrow();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    // The three End of day questions are the panel's own drafts, not a question to the AI.
    if (showReasons && /^draft the reasons/i.test(text)) return void loadReasons();
    if (showTomorrow && /^write (tomorrow|monday)'?s line/i.test(text)) return void loadTomorrow();
    if (showShort && /^make the report shorter/i.test(text)) return void applyShort();
    setAsked(text);
    setAnswer(null);
    setAnswerError(null);
    setSetNote(null);
    setAnswerNote(null);
    startAsk(async () => {
      const r = await askAboutPage(context, text);
      if (!r.ok) return setAnswerError({ error: r.error, reply: r.reply });
      setAnswer(r.answer);
    });
  };

  function writeField() {
    setDraft(null);
    setFindings(null);
    setDraftError(null);
    startDraft(async () => {
      if (keyFindingStar) {
        const k = await draftKeyFinding(context);
        if (!k.ok) return setDraftError({ error: k.error, reply: k.reply });
        setFindings(k.draft);
        return;
      }
      const r = await draftField(context);
      if (!r.ok) return setDraftError({ error: r.error, reply: r.reply });
      setDraft(r.text);
    });
  }

  const setNext = (text: string) => {
    setSetNote(null);
    startSet(async () => {
      const r = await setNextActionFromAi(context, text);
      if (!r.ok) return setSetNote(r.error);
      setSetNote(`Set as ${r.where}.`);
      router.refresh();
    });
  };

  /** "Set next action: <action>" under an answer: the record's next action (the answer's date or tomorrow), or a to-do for today. */
  const setNextFromAnswer = (a: Answer) => {
    if (!a.nextAction) return;
    setAnswerNote(null);
    startSet(async () => {
      const r = await setNextActionFromAnswer(context, a.nextAction!, a.nextActionDue);
      if (!r.ok) return setAnswerNote({ ok: false, text: r.error });
      setAnswerNote({ ok: true, text: r.note });
      router.refresh();
    });
  };

  const addTask = (text: string) => {
    setSetNote(null);
    startSet(async () => {
      const r = await addTaskFromAi(context, text);
      if (!r.ok) return setSetNote(r.error);
      setSetNote(`Added as a task: ${text}`);
      router.refresh();
    });
  };

  const ready = !!setup?.ready;
  const pills = spec.questions;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={<span className="text-violet" data-testid="ask-ai-title">{spec.title}</span>} sub={spec.sub} testId="ask-ai-panel">
      {setupError ? (
        <p className="mb-4 text-[13px] text-status-missed" role="alert" data-testid="ask-ai-error">
          {setupError}
        </p>
      ) : null}
      {setup && !setup.ready ? (
        <p className="mb-4 rounded-lg border border-status-soon-border bg-status-soon-bg px-3.5 py-2.5 text-[13px] text-status-soon" role="status" data-testid="ask-ai-not-ready">
          {setup.notReady}
        </p>
      ) : null}
      {setup?.ready && setup.capWarning ? (
        <p className="mb-4 text-[12.5px] text-status-soon" role="status" data-testid="ask-ai-cap-warning">
          {setup.capWarning}
        </p>
      ) : null}

      {field ? (
        <section className="mb-6" data-testid="ask-ai-field">
          <PanelHeading
            right={
              <AiButton busy={drafting} onClick={writeField} disabled={!ready} className="h-7 px-2.5 text-xs" data-testid="ask-ai-write-again">
                {draft ? "Write it again" : "Write it"}
              </AiButton>
            }
          >
            Fill the {field.label} field
          </PanelHeading>
          {drafting ? <Thinking className="text-[13px] text-muted-foreground" label="Thinking" /> : null}
          {draftError ? <AiFailLine error={draftError.error} reply={draftError.reply} onRetry={writeField} testId="ask-ai-draft-error" /> : null}
          {findings ? <KeyFindingDraftView draft={findings} onUse={() => onUseFindings?.(findings)} /> : null}
          {draft ? (
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-draft">
              <p className="text-sm whitespace-pre-wrap text-slate-800">{draft}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onUse?.(draft)} className={VIOLET_BUTTON} data-testid="ask-ai-use">
                  {field.key === "tomorrow_line" ? "Use this line" : "Use this"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {suggest ? (
        <section className="mb-6" data-testid="ask-ai-steps" data-kind={suggest.kind}>
          <PanelHeading
            right={
              <AiButton busy={stepsLoading} onClick={loadSuggestions} disabled={!ready} className="h-7 px-2.5 text-xs" data-testid="ask-ai-steps-again">
                {suggest.button}
              </AiButton>
            }
          >
            {suggest.heading}
          </PanelHeading>
          {stepsLoading ? <Thinking className="text-[13px] text-muted-foreground" label="Reading this page and thinking" /> : null}
          {stepsError ? <AiFailLine error={stepsError.error} reply={stepsError.reply} onRetry={loadSuggestions} testId="ask-ai-steps-error" /> : null}
          {stepsNote ? (
            <p className="text-[13px] text-status-met" role="status" data-testid="ask-ai-steps-note">
              {stepsNote}
            </p>
          ) : null}
          {!steps && !stepsLoading && !stepsError && !stepsNote && suggest.kind === "questions" ? <p className="text-[13px] text-muted-foreground">The AI reads the deal and adds questions it has not asked yet to the three groups.</p> : null}
          {nextSuggestion ? (
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-next-action">
              <p className="text-sm font-medium text-slate-900" data-testid="ask-ai-next-text">
                {nextSuggestion.action}
              </p>
              <p className="mt-1 text-[13px] text-slate-700" data-testid="ask-ai-next-due" data-due={nextSuggestion.due} data-minutes={nextSuggestion.minutes ?? ""}>
                Due {fmtDate(nextSuggestion.due, "EEE MMM d")}
                {nextSuggestion.minutes ? ` · ${nextSuggestion.minutes} min` : ""}
              </p>
              {nextSuggestion.reason ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{nextSuggestion.reason}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {onUseNext ? (
                  <button type="button" onClick={() => onUseNext(nextSuggestion)} className={VIOLET_BUTTON} data-testid="ask-ai-use-next">
                    {suggest.use}
                  </button>
                ) : (
                  <button type="button" onClick={() => setNext(nextSuggestion.action)} disabled={setting} className={VIOLET_BUTTON} data-testid="ask-ai-set-next">
                    Set as next action
                  </button>
                )}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">Use this fills the card. Nothing is saved until you press Save.</p>
            </div>
          ) : null}
          {steps?.map((s, i) => (
            <div key={i} className="border-b border-slate-100 py-3 first:pt-0 last:border-b-0" data-testid="ask-ai-step">
              <p className="text-sm text-slate-900">{s.text}</p>
              {s.reason ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{s.reason}</p> : null}
              <button type="button" onClick={() => (suggest.kind === "tasks" ? addTask(s.text) : setNext(s.text))} disabled={setting} className={cn(VIOLET_BUTTON, "mt-2")} data-testid={suggest.kind === "tasks" ? "ask-ai-add-task" : "ask-ai-set-next"}>
                {suggest.use}
              </button>
            </div>
          ))}
          {setNote ? (
            <p className={cn("pt-2 text-[13px]", setNote.startsWith("Set as") || setNote.startsWith("Added as") ? "text-status-met" : "text-status-missed")} role="status" data-testid="ask-ai-set-note">
              {setNote}
            </p>
          ) : null}
        </section>
      ) : null}

      {showReasons ? (
        <section className="mb-6" data-testid="ask-ai-reasons">
          <PanelHeading
            right={
              <AiButton busy={reasonsBusy} onClick={loadReasons} disabled={!ready || !!closedWord} className="h-7 px-2.5 text-xs" data-testid="ask-ai-reasons-again">
                {reasons ? "Draft them again" : "Draft the reasons"}
              </AiButton>
            }
          >
            Reasons for the missed commitments
          </PanelHeading>
          {closedWord ? <p className="text-[13px] text-muted-foreground">{closedWord}</p> : null}
          {reasonsBusy ? <Thinking className="text-[13px] text-muted-foreground" label="Reading today and thinking" /> : null}
          {reasonsError ? <AiFailLine error={reasonsError.error} reply={reasonsError.reply} onRetry={loadReasons} testId="ask-ai-reasons-error" /> : null}
          {reasons ? (
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-reasons-drafts">
              {reasons.map((d) => (
                <div key={d.targetId} className="border-b border-violet-rule py-2 first:pt-0 last:border-b-0 last:pb-0" data-testid="ask-ai-reason-draft">
                  <span className="block text-xs text-muted-foreground">{d.name}</span>
                  <p className="text-sm text-slate-800">{d.reason}</p>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => { eod?.onUseReasons?.(reasons); setReasonsNote("Filled in. Change them on the page."); }} disabled={!!closedWord} className={VIOLET_BUTTON} data-testid="ask-ai-use-reasons">
                  Use these
                </button>
                <button type="button" onClick={() => onOpenChange(false)} className={cn(ROW_BUTTON_BASE, ROW_BUTTON_TONE.outline)}>
                  Not now
                </button>
              </div>
              {reasonsNote ? <p className="mt-2 text-[13px] text-status-met" role="status" data-testid="ask-ai-reasons-note">{reasonsNote}</p> : null}
            </div>
          ) : null}
          {!reasons && !reasonsBusy && !reasonsError && !closedWord ? <p className="text-[13px] text-muted-foreground">One line per missed commitment, from what today shows.</p> : null}
        </section>
      ) : null}

      {showTomorrow ? (
        <section className="mb-6" data-testid="ask-ai-tomorrow">
          <PanelHeading
            right={
              <AiButton busy={tomorrowBusy} onClick={loadTomorrow} disabled={!ready || !!closedWord} className="h-7 px-2.5 text-xs" data-testid="ask-ai-tomorrow-again">
                {tomorrowDraft ? "Write it again" : "Write the line"}
              </AiButton>
            }
          >
            What matters tomorrow
          </PanelHeading>
          {tomorrowBusy ? <Thinking className="text-[13px] text-muted-foreground" label="Reading tomorrow's actions and thinking" /> : null}
          {tomorrowError ? <AiFailLine error={tomorrowError.error} reply={tomorrowError.reply} onRetry={loadTomorrow} testId="ask-ai-tomorrow-error" /> : null}
          {tomorrowDraft ? (
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-tomorrow-draft">
              <p className="text-sm whitespace-pre-wrap text-slate-800">{tomorrowDraft}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => { eod?.onUseTomorrow?.(tomorrowDraft); setTomorrowNote("Set as the line. Edit it on the page."); }} disabled={!!closedWord} className={VIOLET_BUTTON} data-testid="ask-ai-use-tomorrow">
                  Use this line
                </button>
              </div>
              {tomorrowNote ? <p className="mt-2 text-[13px] text-status-met" role="status" data-testid="ask-ai-tomorrow-note">{tomorrowNote}</p> : null}
            </div>
          ) : null}
          {!tomorrowDraft && !tomorrowBusy && !tomorrowError ? <p className="text-[13px] text-muted-foreground">One line about the next working day, from the next actions due and the open waits.</p> : null}
        </section>
      ) : null}

      {showShort ? (
        <section className="mb-6" data-testid="ask-ai-short">
          <PanelHeading>A shorter report</PanelHeading>
          <p className="text-[13px] text-slate-700">The short version keeps the header, the Targets list with the reasons, the week tiles on a Friday, and the tomorrow line. It drops the Today tiles and the Deals bullets, which the daily reports already carry.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={applyShort} disabled={shortBusy || !!closedWord} className={VIOLET_BUTTON} data-testid="ask-ai-use-short">
              {shortBusy ? <Thinking /> : "Use the short version"}
            </button>
            {shortNote ? <span className="text-[13px] text-status-met" role="status" data-testid="ask-ai-short-note">{shortNote}</span> : null}
            {closedWord ? <span className="text-[13px] text-muted-foreground">{closedWord}</span> : null}
          </div>
        </section>
      ) : null}

      <section data-testid="ask-ai-ask">
        <PanelHeading>{spec.askHeading}</PanelHeading>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                ask(question);
              }
            }}
            placeholder="Type a question"
            aria-label="Type a question"
            disabled={!ready}
            className={INPUT}
            data-testid="ask-ai-question"
          />
          <RowButton tone="primary" onClick={() => ask(question)} disabled={!ready || asking || !question.trim()} className={cn("h-9 shrink-0", asking && "border-border bg-slate-50 text-slate-400 disabled:opacity-100")} data-testid="ask-ai-ask-button">
            {asking ? <Thinking /> : "Ask"}
          </RowButton>
        </div>
        {pills.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2" data-testid="ask-ai-pills">
            {pills.map((p) => (
              <button key={p} type="button" onClick={() => { setQuestion(p); ask(p); }} disabled={!ready || asking} className="inline-flex items-center rounded-full border border-violet-rule bg-violet-soft px-3 py-1 text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-[#f3ecff] disabled:opacity-50" data-testid="ask-ai-pill">
                {p}
              </button>
            ))}
          </div>
        ) : null}
        {asking ? <Thinking className="mt-3 text-[13px] text-muted-foreground" label="Reading this page and thinking" /> : null}
        {answerError ? <AiFailLine error={answerError.error} reply={answerError.reply} onRetry={() => ask(asked ?? question)} testId="ask-ai-answer-error" className="mt-3" /> : null}
        {answer ? (
          <div className="mt-3 rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-answer">
            {asked ? <p className="mb-1.5 text-[13px] font-medium text-violet">{asked}</p> : null}
            <ul className="flex flex-col gap-1.5 pl-4 text-sm text-slate-800">
              {answer.bullets.map((b, i) => (
                <li key={i} className="list-disc">
                  <Bullet text={b} />
                </li>
              ))}
            </ul>
            {answer.nextAction || (answer.email && compose) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {setNextActionLabel(answer) ? (
                  <button type="button" onClick={() => setNextFromAnswer(answer)} disabled={setting || !!answerNote?.ok} className={cn(VIOLET_BUTTON, "h-auto min-h-[30px] py-1 text-left whitespace-normal")} title={answer.nextAction ?? undefined} data-testid="ask-ai-make-next">
                    {setNextActionLabel(answer)}
                  </button>
                ) : null}
                {answer.email && compose ? (
                  <button type="button" onClick={() => setEmailOpen(true)} className={SOFT_BUTTON} data-testid="ask-ai-open-email">
                    <Mail className="mr-1.5 h-3.5 w-3.5" /> Open in email
                  </button>
                ) : null}
              </div>
            ) : null}
            {answerNote ? (
              <p className={cn("mt-2 text-[13px]", answerNote.ok ? "text-status-met" : "text-status-missed")} role="status" data-testid="ask-ai-answer-note">
                {answerNote.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      {answer?.email && compose && emailOpen ? <ComposeEmailDialog setup={compose} open={emailOpen} onOpenChange={setEmailOpen} initial={{ subject: answer.email.subject, body: answer.email.body }} ask={context} /> : null}
    </Drawer>
  );
}
