"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { addTaskFromAi, askAboutPage, askAiSetup, draftField, setNextActionFromAi, suggestNextSteps, suggestQuestionsFromAi, suggestTasks, type AskSetup } from "@/app/actions/ask-ai";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { panelSpec, type Answer, type AskContext, type AskField, type NextStep } from "@/lib/work/ask-ai";
import { Drawer } from "@/components/app/work/drawer";
import { AiButton, RowButton, Thinking } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Ask AI element (approved 2026-10-31, decisions on v2 and v3; the panel built in batch B2; Edit batch B, item
 * 3, 2026-11-01). Three levels: the page pill (a pill like the filter pills, a little taller, with the small purple
 * four-point star; the panel reads the page), the purple star at the right of a card header (the panel is about that
 * card), and the star inside a field (visible only while the field is empty or being edited; the panel writes the
 * field and "Use this" fills it). The purple star is the one mark that means AI; the card and field stars sit in a
 * faint purple circle. The panel (a right-side drawer, about 480px, 28px gutters) opens at once with its title, its
 * three suggested questions, and its sections (panelSpec, in the browser); the cost line and the suggestions load
 * into it. Opened from a card or a field the whole panel is about that thing: "Ask AI about Tasks" with questions
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

export type AskAiProps = {
  context: AskContext;
  /** The email setup for "Open in email" (record pages with a contact; Home with a typed address). */
  compose?: ComposeSetup | null;
};

/** The page-level pill in every Work page header. */
export function AskAiPill({ context, compose, className }: AskAiProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-white px-3.5 text-[13px] font-medium whitespace-nowrap text-slate-800 hover:bg-slate-50", className)} data-testid="ask-ai">
        <AiStar />
        Ask AI
      </button>
      {open ? <AskAiPanel context={context} compose={compose} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/** The faint circle behind the card and field stars (the AI's soft purple with its rule as the edge). */
const STAR_CIRCLE = "inline-flex shrink-0 items-center justify-center rounded-full border border-violet-rule bg-violet-soft hover:border-violet/40 hover:bg-[#f3ecff]";

/** The purple star at the right of a card header (21px, in a 34px faint circle; hover shows "Ask AI"); opens the panel about that card. */
export function AiCardStar({ context, compose, className, testId = "ai-card-star" }: AskAiProps & { className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Ask AI" aria-label={`Ask AI about ${context.card ?? context.label}`} className={cn(STAR_CIRCLE, "h-[34px] w-[34px]", className)} data-testid={testId} data-card={context.card ?? undefined}>
        <AiStar className="h-[21px] w-[21px]" />
      </button>
      {open ? <AskAiPanel context={context} compose={compose} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/**
 * The star inside a field (20px, in a 28px faint circle): shown while the field is empty or focused. Wrap the input
 * in a `relative` box and give the input right padding (pr-9). `onUse` fills the field with the AI's text.
 */
export function AiFieldStar({ context, field, visible, onUse, className, testId = "ai-field-star" }: { context: Omit<AskContext, "field">; field: AskField; visible: boolean; onUse: (text: string) => void; className?: string; testId?: string }) {
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
      {open ? <AskAiPanel context={{ ...context, card: null, field }} open={open} onOpenChange={setOpen} onUse={(t) => { onUse(t); setOpen(false); }} /> : null}
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

const VIOLET_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet bg-white px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-violet-soft disabled:pointer-events-none disabled:opacity-50";
const SOFT_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet-rule bg-violet-soft px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-[#f3ecff] disabled:pointer-events-none disabled:opacity-50";
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function AskAiPanel({ context, compose, open, onOpenChange, onUse }: { context: AskContext; compose?: ComposeSetup | null; open: boolean; onOpenChange: (open: boolean) => void; /** A field star: "Use this" fills the field. */ onUse?: (text: string) => void }) {
  const router = useRouter();
  const spec = panelSpec(context);
  const [setup, setSetup] = useState<AskSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [steps, setSteps] = useState<NextStep[] | null>(null);
  const [stepsError, setStepsError] = useState<FailState>(null);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsNote, setStepsNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerError, setAnswerError] = useState<FailState>(null);
  const [asking, startAsk] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<FailState>(null);
  const [drafting, startDraft] = useTransition();
  const [setting, startSet] = useTransition();
  const [setNote, setSetNote] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const loaded = useRef(false);
  const field = context.field ?? null;
  const suggest = spec.suggest;

  /** The suggestions of this panel: next steps, tasks, or questions (the last adds to the deal and reports the count). */
  const loadSuggestions = async () => {
    if (!suggest) return;
    setSteps(null);
    setStepsError(null);
    setStepsNote(null);
    setStepsLoading(true);
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
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setAsked(text);
    setAnswer(null);
    setAnswerError(null);
    setSetNote(null);
    startAsk(async () => {
      const r = await askAboutPage(context, text);
      if (!r.ok) return setAnswerError({ error: r.error, reply: r.reply });
      setAnswer(r.answer);
    });
  };

  function writeField() {
    setDraft(null);
    setDraftError(null);
    startDraft(async () => {
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
  const estimate = setup?.estimate ? `One call is ${setup.estimate}.` : null;
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
          {draft ? (
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-4 py-3.5" data-testid="ask-ai-draft">
              <p className="text-sm whitespace-pre-wrap text-slate-800">{draft}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onUse?.(draft)} className={VIOLET_BUTTON} data-testid="ask-ai-use">
                  Use this
                </button>
              </div>
            </div>
          ) : null}
          {!draft && !drafting && !draftError && estimate ? <p className="text-xs text-muted-foreground">{estimate}</p> : null}
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
        {estimate && ready && !answer && !asking ? (
          <p className="mt-2.5 text-xs text-muted-foreground" data-testid="ask-ai-estimate">
            {estimate} The AI reads only what is on this page.
          </p>
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
                {answer.nextAction ? (
                  <button type="button" onClick={() => setNext(answer.nextAction!)} disabled={setting} className={VIOLET_BUTTON} title={answer.nextAction} data-testid="ask-ai-make-next">
                    Make this the next action
                  </button>
                ) : null}
                {answer.email && compose ? (
                  <button type="button" onClick={() => setEmailOpen(true)} className={SOFT_BUTTON} data-testid="ask-ai-open-email">
                    <Mail className="mr-1.5 h-3.5 w-3.5" /> Open in email
                  </button>
                ) : null}
              </div>
            ) : null}
            {setNote && !suggest ? (
              <p className={cn("mt-2 text-[13px]", setNote.startsWith("Set as") ? "text-status-met" : "text-status-missed")} role="status" data-testid="ask-ai-set-note">
                {setNote}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      {answer?.email && compose && emailOpen ? <ComposeEmailDialog setup={compose} open={emailOpen} onOpenChange={setEmailOpen} initial={{ subject: answer.email.subject, body: answer.email.body }} ask={context} /> : null}
    </Drawer>
  );
}
