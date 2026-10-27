"use client";

/**
 * Start an initiative, step by step, in the large window:
 * Describe (typed or spoken; the AI drafts) > Name and purpose > Goals > Milestones > Tasks > Target and budget >
 * Plan and checklists > Review and approve. The step bar stays in view and any step can be opened directly; Save checks
 * the step and moves to the next one; "Save for later" keeps the draft (Drafts waiting for review); Approve creates
 * every included item in one transaction (the same approval as the review page). "Add manually" starts at Name and
 * purpose with an empty draft and no AI. Each step has its own address (src/lib/window-route.ts).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/app/page-header";
import { SummaryContent } from "@/components/app/initiative-summary";
import { StartInitiativeBox } from "@/components/app/start-initiative-box";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { flashMessage, useWindowNav } from "@/components/app/window-host";
import { FullPageButton, Skeleton, useLoad, ViewLayout, clearWindowCache } from "@/components/app/windows/views";
import {
  draftSavings,
  GoalsEditor,
  IdeaModeChoice,
  MilestonesEditor,
  NameEditor,
  PlanChecklistsEditor,
  ReductionForm,
  TargetBudgetEditor,
  TasksEditor,
  type EditorProps,
  type Setter,
} from "@/components/app/draft-review";
import { approveSetup, discardSetup, loadSetup, loadSetupStart, saveSetupStep, startManualDraft, type SetupData } from "@/app/actions/window";
import { SETUP_STEP_HELP, SETUP_STEP_LABEL, SETUP_STEPS, nextStep, previousStep, stepForField, stepPosition, type SetupStep } from "@/lib/window-route";
import { selectedCount, type DraftState } from "@/lib/initiative/draft";
import { summaryFromProposal, type SummaryRef } from "@/lib/initiative/summary";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SetupWindow() {
  const { view } = useWindowNav();
  if (view.kind !== "setup") return null;
  if (view.draftId === null) return view.manual ? <ManualStart /> : <DescribeStart />;
  return <DraftSetup draftId={view.draftId} step={view.step} />;
}

/** The step bar: always in view; every step can be opened directly once there is a draft. */
function StepBar({ current, onPick, disabled = false }: { current: SetupStep; onPick: (s: SetupStep) => void; disabled?: boolean }) {
  const { index, total } = stepPosition(current);
  return (
    <nav aria-label="Setup steps" data-testid="setup-steps">
      <p className="mb-1.5 text-xs font-medium text-slate-600 sm:hidden">
        Step {index} of {total}: <span className="text-slate-900">{SETUP_STEP_LABEL[current]}</span>
      </p>
      <ol className="grid grid-cols-8 gap-1">
        {SETUP_STEPS.map((s, i) => {
          const state = i + 1 < index ? "done" : i + 1 === index ? "current" : "next";
          return (
            <li key={s} className="min-w-0">
              <button
                type="button"
                disabled={disabled && s !== current}
                onClick={() => onPick(s)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn("group flex w-full min-w-0 flex-col gap-1 rounded-md px-0.5 pb-0.5 pt-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", disabled && s !== current ? "cursor-default" : "hover:bg-primary-soft/50")}
                data-testid={`setup-step-${s}`}
              >
                <span className={cn("h-1 w-full rounded-full", state === "next" ? "bg-slate-200" : "bg-primary")} />
                <span className="hidden min-w-0 items-start gap-1.5 sm:flex">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular",
                      state === "current" ? "bg-primary text-white" : state === "done" ? "bg-primary-soft text-primary-strong" : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className={cn("clamp-2 text-xs leading-4", state === "current" ? "font-semibold text-slate-900" : "text-slate-600")}>{SETUP_STEP_LABEL[s]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepHelp({ step }: { step: SetupStep }) {
  return (
    <p className="mb-4 max-w-[75ch] text-sm text-slate-700" data-testid="setup-help">
      {SETUP_STEP_HELP[step]}
    </p>
  );
}

// ---------- Step 1 for a new initiative ----------

function DescribeStart() {
  const nav = useWindowNav();
  const { data } = useLoad("setup-start", () => loadSetupStart());
  return (
    <ViewLayout title="Start an initiative" subtitle="Step 1 of 8: Describe" toolbar={<StepBar current="describe" onPick={() => {}} disabled />} footer={<FullPageButton href="/plan/start" />}>
      <StepHelp step="describe" />
      {!data ? (
        <Skeleton />
      ) : !data.ok ? (
        <Notice tone="warn">{data.error}</Notice>
      ) : !data.available ? (
        <Notice tone="warn">Start an initiative appears after database update 0014 (supabase/UPDATE_0013_0014_RUN_ONCE.sql).</Notice>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
          <section className="rounded-xl border border-border bg-white p-4">
            <StartInitiativeBox aiReady={data.aiReady} onDrafted={(id) => nav.replace({ kind: "setup", draftId: id, step: "name" })} />
          </section>
          <section className="rounded-xl border border-border bg-white px-4 pb-3 pt-3.5">
            <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Drafts waiting for review</h3>
            {data.drafts.length ? (
              <ul className="flex flex-col">
                {data.drafts.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => nav.push({ kind: "draft", id: d.id })} className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left hover:bg-primary-soft">
                      <span className="clamp-1 text-sm font-medium text-slate-900">{d.name}</span>
                      <span className="clamp-1 text-xs text-muted-foreground">
                        {d.manual ? "Added manually" : d.source === "savings_idea" ? "From a savings idea" : d.source === "chat" ? "From the AI chat" : "Typed or spoken"}, {dateTime(d.created)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No drafts waiting.</p>
            )}
          </section>
        </div>
      )}
    </ViewLayout>
  );
}

/** Add manually: makes an empty draft, then opens Name and purpose. */
function ManualStart() {
  const nav = useWindowNav();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startManualDraft().then((r) => {
      if (r.ok) nav.replace({ kind: "setup", draftId: r.id, step: "name" });
      else setError(r.error);
    });
  }, [nav]);
  return (
    <ViewLayout title="Add an initiative" toolbar={<StepBar current="name" onPick={() => {}} disabled />}>
      {error ? <Notice tone="warn">{error}</Notice> : <Skeleton />}
    </ViewLayout>
  );
}

// ---------- The steps of one draft ----------

function DraftSetup({ draftId, step }: { draftId: string; step: SetupStep }) {
  const { data } = useLoad<SetupData>(`setup:${draftId}`, () => loadSetup(draftId));
  if (!data) {
    return (
      <ViewLayout title="Start an initiative" toolbar={<StepBar current={step} onPick={() => {}} disabled />}>
        <Skeleton />
      </ViewLayout>
    );
  }
  if (!data.ok) {
    return (
      <ViewLayout title="Start an initiative" footer={<FullPageButton href={`/plan/initiatives/drafts/${draftId}`} />}>
        <Notice tone="warn">{data.error}</Notice>
      </ViewLayout>
    );
  }
  if (data.status !== "draft") {
    return (
      <ViewLayout title="Start an initiative" footer={data.resultHref ? <FullPageButton href={data.resultHref} variant="default" /> : null}>
        <Notice>{data.status === "approved" ? "This draft was approved and its records were created." : "This draft was discarded. Nothing was created."}</Notice>
      </ViewLayout>
    );
  }
  return <DraftSteps data={data} step={step} />;
}

function DraftSteps({ data, step }: { data: Extract<SetupData, { ok: true }>; step: SetupStep }) {
  const nav = useWindowNav();
  const [state, setState] = useState<DraftState>(data.state);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(data.state));
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"initiative" | "reduction">("initiative");
  const [pending, start] = useTransition();
  const json = JSON.stringify(state);
  const dirty = json !== savedJson;
  useUnsavedWork(dirty, "This initiative has changes that are not saved. Save keeps them; nothing is created until you approve.");
  const errorRef = useRef<HTMLDivElement>(null);

  const set: Setter = (fn) => {
    setError(null);
    setState((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  };
  const editor: EditorProps = { state, set, initiatives: data.initiatives, categories: data.categories, categorySpend: data.categorySpend, today: data.today };
  const { budgetCurrent } = draftSavings(state, data.categorySpend, data.savingsIdea?.estimate_basis);
  const { selected, total } = selectedCount(state);
  const name = state.proposal.initiative.name.trim();
  const goTo = (s: SetupStep) => {
    setError(null);
    nav.push({ kind: "setup", draftId: data.id, step: s });
  };
  const showError = (e: string) => {
    setError(e);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "nearest" }));
  };

  // "Save and close" (closing with unsaved changes) keeps the draft as it is.
  const latest = useRef(json);
  useEffect(() => {
    latest.current = json;
  }, [json]);
  useEffect(() => {
    nav.setSaver(async () => {
      const now = latest.current;
      const r = await saveSetupStep(data.id, now, "later");
      if (r.ok) {
        setSavedJson(now);
        clearWindowCache();
        flashMessage("Saved for later. The draft is in Drafts waiting for review.");
      }
      return r.ok;
    });
    return () => nav.setSaver(null);
  }, [nav, data.id]);

  const save = () =>
    start(async () => {
      const r = await saveSetupStep(data.id, json, step);
      if (!r.ok) return showError(r.error);
      setSavedJson(json);
      clearWindowCache();
      goTo(nextStep(step));
    });
  const saveForLater = () =>
    start(async () => {
      const r = await saveSetupStep(data.id, json, "later");
      if (!r.ok) return showError(r.error);
      setSavedJson(json);
      clearWindowCache();
      flashMessage("Saved for later. The draft is in Drafts waiting for review.");
      nav.close();
      nav.refreshPage();
    });
  const approve = () =>
    start(async () => {
      const r = await approveSetup(data.id, json);
      if (!r.ok) return showError(r.error);
      setSavedJson(json);
      clearWindowCache();
      flashMessage(r.message);
      nav.replace({ kind: "record", table: "initiatives", id: r.initiativeId });
      nav.refreshPage();
    });
  const discard = () =>
    start(async () => {
      const r = await discardSetup(data.id);
      if (!r.ok) return showError(r.error);
      setSavedJson(json);
      clearWindowCache();
      flashMessage("Draft discarded. Nothing was saved.");
      nav.close();
      nav.refreshPage();
    });

  const pick = (r: SummaryRef) => {
    if (r.kind === "field") goTo(stepForField(r.anchor));
    else if (r.kind === "plan") goTo("plan");
  };
  const prev = previousStep(step);
  const { index, total: steps } = stepPosition(step);
  const reduction = mode === "reduction" && !!data.savingsIdea;

  let body: React.ReactNode;
  switch (step) {
    case "describe":
      body = (
        <section className="max-w-[75ch] rounded-xl border border-border bg-white p-4" data-testid="setup-describe">
          <p className="text-xs font-medium text-slate-500">{data.manual ? "Added manually" : data.fromIdea ? "From a savings idea" : "Your words"}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{data.manual ? "This initiative is filled in step by step, with no AI." : data.prompt || "No description."}</p>
        </section>
      );
      break;
    case "name":
      body = <NameEditor {...editor} />;
      break;
    case "goals":
      body = <GoalsEditor {...editor} hideTitle />;
      break;
    case "milestones":
      body = <MilestonesEditor {...editor} hideTitle />;
      break;
    case "tasks":
      body = <TasksEditor {...editor} hideTitle />;
      break;
    case "target":
      body = <TargetBudgetEditor {...editor} hideTitle />;
      break;
    case "plan":
      body = <PlanChecklistsEditor {...editor} hideTitle />;
      break;
    case "review":
      body = (
        <div className="flex flex-col gap-4" data-testid="setup-review">
          {data.savingsIdea ? <IdeaModeChoice mode={mode} setMode={setMode} /> : null}
          {reduction && data.savingsIdea ? (
            <ReductionForm draftId={data.id} idea={data.savingsIdea} today={data.today} onError={(e) => (e ? showError(e) : setError(null))} />
          ) : (
            <>
              <SummaryContent
                s={summaryFromProposal(state.proposal, state.include, budgetCurrent)}
                pick={pick}
                aside={
                  <div className="relative flex h-full flex-col justify-center overflow-hidden rounded-xl border border-action-stripe/25 bg-action-bg px-4 py-3" data-testid="setup-next-action">
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-action-stripe" />
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Next required action</p>
                    <p className="mt-1 text-base font-semibold leading-snug text-slate-900">Check the summary, then press Approve selected.</p>
                    <p className="mt-1 text-sm text-slate-700">
                      <span className="font-semibold">{selected}</span> of {total} items selected. All are created together, linked to the initiative.
                    </p>
                  </div>
                }
              />
            </>
          )}
        </div>
      );
      break;
  }

  return (
    <ViewLayout
      title={name ? `Start an initiative: ${name}` : "Start an initiative"}
      subtitle={`Step ${index} of ${steps}: ${SETUP_STEP_LABEL[step]}`}
      toolbar={<StepBar current={step} onPick={goTo} />}
      headerActions={<FullPageButton href={`/plan/initiatives/drafts/${data.id}`} />}
      footer={
        <>
          {prev ? (
            <Button size="sm" variant="ghost" onClick={() => goTo(prev)} disabled={pending} data-testid="setup-previous">
              <ArrowLeft /> {SETUP_STEP_LABEL[prev]}
            </Button>
          ) : null}
          {step === "review" ? (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={discard} disabled={pending} data-testid="setup-discard">
              Discard draft
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={saveForLater} disabled={pending} data-testid="setup-save-later">
            Save for later
          </Button>
          {step === "review" ? (
            reduction ? null : (
              <Button size="sm" onClick={approve} disabled={pending || !name} data-testid="setup-approve">
                <CheckCircle2 /> {pending ? "Creating the records..." : `Approve selected (${selected})`}
              </Button>
            )
          ) : (
            <Button size="sm" onClick={save} disabled={pending} data-testid="setup-save">
              {pending ? "Saving..." : `Save and continue to ${SETUP_STEP_LABEL[nextStep(step)]}`} {pending ? null : <ArrowRight />}
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-h-full flex-col" data-testid={`setup-body-${step}`}>
        <div ref={errorRef}>
          {error ? (
            <div className="mb-4" role="alert" data-testid="setup-error">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </div>
        <StepHelp step={step} />
        {body}
      </div>
    </ViewLayout>
  );
}
