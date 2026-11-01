"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { askAboutPage, askAiSetup, draftField, setNextActionFromAi, suggestNextSteps, type AskSetup } from "@/app/actions/ask-ai";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { contextLabel, type Answer, type AskContext, type AskField, type NextStep } from "@/lib/work/ask-ai";
import { Drawer } from "@/components/app/work/drawer";
import { RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Ask AI element (approved 2026-10-31, decisions on v2 and v3; the panel built in batch B2). Three levels: the
 * page pill (a pill like the filter pills, a little taller, with the small purple four-point star; the panel reads
 * the page), the purple star at the right of a card header (the panel reads that card), and the star inside a field
 * (visible only while the field is empty or being edited; the panel writes the field and "Use this" fills it). The
 * purple star is the one mark that means AI. The panel (a right-side drawer, about 480px, 28px gutters): Suggested
 * next steps on record pages (up to three with a one-line reason and Set as next action), then Ask about this page
 * (a question box, three suggested questions, the answer in short bullets, Make this the next action and Open in
 * email where they apply). Everything AI-related is purple; a one-line cost estimate shows before a call.
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

/** The small purple star at the right of a card header (hover shows "Ask AI"); opens the panel with that card as context. */
export function AiCardStar({ context, compose, className, testId = "ai-card-star" }: AskAiProps & { className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Ask AI" aria-label={`Ask AI about ${context.card ?? context.label}`} className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-violet-soft", className)} data-testid={testId} data-card={context.card ?? undefined}>
        <AiStar className="h-[14px] w-[14px]" />
      </button>
      {open ? <AskAiPanel context={context} compose={compose} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

/**
 * The star inside a field: shown while the field is empty or focused. Wrap the input in a `relative` box and give
 * the input right padding (pr-8). `onUse` fills the field with the AI's text.
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
        className={cn("absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full hover:bg-violet-soft", !visible && "hidden", className)}
        data-testid={testId}
        data-field={field.key}
      >
        <AiStar />
      </button>
      {open ? <AskAiPanel context={{ ...context, field }} open={open} onOpenChange={setOpen} onUse={(t) => { onUse(t); setOpen(false); }} /> : null}
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
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
      <h3 className="text-[12.5px] font-medium tracking-[0.09em] text-violet uppercase">{children}</h3>
      {right}
    </div>
  );
}

const VIOLET_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet bg-white px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-violet-soft disabled:pointer-events-none disabled:opacity-50";
const SOFT_BUTTON = "inline-flex h-[30px] items-center justify-center rounded-[7px] border border-violet/30 bg-violet-soft px-[11px] text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-[#ebe3fb] disabled:pointer-events-none disabled:opacity-50";
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function AskAiPanel({ context, compose, open, onOpenChange, onUse }: { context: AskContext; compose?: ComposeSetup | null; open: boolean; onOpenChange: (open: boolean) => void; /** A field star: "Use this" fills the field. */ onUse?: (text: string) => void }) {
  const router = useRouter();
  const [setup, setSetup] = useState<AskSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [steps, setSteps] = useState<NextStep[] | null>(null);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [asking, startAsk] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();
  const [setting, startSet] = useTransition();
  const [setNote, setSetNote] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const loaded = useRef(false);
  const field = context.field ?? null;

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    let alive = true;
    (async () => {
      const r = await askAiSetup(context);
      if (!alive) return;
      if (!r.ok) return setSetupError(r.error);
      setSetup(r);
      // Suggested next steps load on their own on a record page (the AI acts without being asked where it is cheap).
      if (r.suggests && r.ready) {
        setStepsLoading(true);
        const s = await suggestNextSteps(context);
        if (!alive) return;
        setStepsLoading(false);
        if (s.ok) setSteps(s.steps);
        else setStepsError(s.error);
      }
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
      if (!r.ok) return setAnswerError(r.error);
      setAnswer(r.answer);
    });
  };

  function writeField() {
    setDraft(null);
    setDraftError(null);
    startDraft(async () => {
      const r = await draftField(context);
      if (!r.ok) return setDraftError(r.error);
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

  const ready = !!setup?.ready;
  const estimate = setup?.estimate ? `One call is ${setup.estimate}.` : null;
  const pills = setup?.questions ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={<span className="text-violet">Ask AI</span>} sub={contextLabel(context)} testId="ask-ai-panel">
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
              <button type="button" onClick={writeField} disabled={!ready || drafting} className="text-xs font-medium text-violet hover:underline disabled:opacity-50" data-testid="ask-ai-write-again">
                {draft ? "Write it again" : "Write it"}
              </button>
            }
          >
            Fill the {field.label} field
          </PanelHeading>
          {drafting ? <p className="text-[13px] text-muted-foreground">Writing...</p> : null}
          {draftError ? (
            <p className="text-[13px] text-status-missed" role="alert" data-testid="ask-ai-draft-error">
              {draftError}
            </p>
          ) : null}
          {draft ? (
            <div className="rounded-lg border border-violet/30 bg-violet-soft px-4 py-3.5" data-testid="ask-ai-draft">
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

      {setup?.suggests ? (
        <section className="mb-6" data-testid="ask-ai-steps">
          <PanelHeading
            right={
              steps ? (
                <button type="button" onClick={() => { setSteps(null); setStepsLoading(true); suggestNextSteps(context).then((s) => { setStepsLoading(false); if (s.ok) setSteps(s.steps); else setStepsError(s.error); }); }} className="text-xs font-medium text-violet hover:underline" data-testid="ask-ai-steps-again">
                  Suggest again
                </button>
              ) : null
            }
          >
            Suggested next steps
          </PanelHeading>
          {stepsLoading ? <p className="text-[13px] text-muted-foreground">Reading this page and thinking...</p> : null}
          {stepsError ? (
            <p className="text-[13px] text-status-missed" role="alert" data-testid="ask-ai-steps-error">
              {stepsError}
            </p>
          ) : null}
          {steps?.map((s, i) => (
            <div key={i} className="border-b border-slate-100 py-3 first:pt-0 last:border-b-0" data-testid="ask-ai-step">
              <p className="text-sm text-slate-900">{s.text}</p>
              {s.reason ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{s.reason}</p> : null}
              <button type="button" onClick={() => setNext(s.text)} disabled={setting} className={cn(VIOLET_BUTTON, "mt-2")} data-testid="ask-ai-set-next">
                Set as next action
              </button>
            </div>
          ))}
          {setNote ? (
            <p className={cn("pt-2 text-[13px]", setNote.startsWith("Set as") ? "text-status-met" : "text-status-missed")} role="status" data-testid="ask-ai-set-note">
              {setNote}
            </p>
          ) : null}
        </section>
      ) : null}

      <section data-testid="ask-ai-ask">
        <PanelHeading>Ask about this page</PanelHeading>
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
          <RowButton tone="primary" onClick={() => ask(question)} disabled={!ready || asking || !question.trim()} className="h-9 shrink-0" data-testid="ask-ai-ask-button">
            Ask
          </RowButton>
        </div>
        {pills.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2" data-testid="ask-ai-pills">
            {pills.map((p) => (
              <button key={p} type="button" onClick={() => { setQuestion(p); ask(p); }} disabled={!ready || asking} className="inline-flex items-center rounded-full border border-violet/30 bg-violet-soft px-3 py-1 text-[12.5px] font-medium whitespace-nowrap text-violet hover:bg-[#ebe3fb] disabled:opacity-50" data-testid="ask-ai-pill">
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
        {asking ? <p className="mt-3 text-[13px] text-muted-foreground">Reading this page and thinking...</p> : null}
        {answerError ? (
          <p className="mt-3 text-[13px] text-status-missed" role="alert" data-testid="ask-ai-answer-error">
            {answerError}
          </p>
        ) : null}
        {answer ? (
          <div className="mt-3 rounded-lg border border-violet/30 bg-violet-soft px-4 py-3.5" data-testid="ask-ai-answer">
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
            {setNote && !setup?.suggests ? (
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
