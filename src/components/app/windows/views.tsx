"use client";

/**
 * What each window shows (the window itself is src/components/app/window-host.tsx):
 * - Record overview (large): initiatives (the summary), goals, pipeline items, scenarios. Every line opens in the same
 *   window. Quick view (medium): tasks, contacts, organizations, milestones, and any other record opened inside a window.
 * - Editor: the shared record form with collapsible sections; Save returns to the overview with "Saved".
 * - Initiative draft overview, plan text, the step-by-step setup (setup-window.tsx), Work through tasks (work-window.tsx).
 */
import { DealScorecard } from "@/components/app/deal-scorecard";
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, LayoutGrid, CalendarClock, CalendarDays, CheckCircle2, Circle, ListChecks, Mail, MessageSquare, Pencil, Phone, Plus, Users } from "lucide-react";
import { WindowLayout } from "@/components/ui/window";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge, StatusBadge, dueClass } from "@/components/ui/badge";
import { NextActionCard } from "@/components/app/next-action-card";
import { SummaryContent } from "@/components/app/initiative-summary";
import { AiText } from "@/components/app/ai-text";
import { Notice } from "@/components/app/page-header";
import { RecordForm } from "@/components/app/record-form";
import { EmailButton } from "@/components/app/compose-email";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";
import { useWindowNav } from "@/components/app/window-host";
import { AskAiButton } from "@/components/app/ask-ai-button";
import { SuggestionLine } from "@/components/app/suggestion-line";
import type { ChatContext } from "@/components/app/chat-bus";
import { SetupWindow } from "@/components/app/windows/setup-window";
import { WorkWindow } from "@/components/app/windows/work-window";
import { TaskWindow } from "@/components/app/windows/task-window";
import { ScenarioSummaryWindow } from "@/components/app/windows/scenario-summary";
import { SentReportView } from "@/components/app/sent-report-view";
import { CollapsibleCard } from "@/components/app/collapsible";
import { DocumentsCard, HistoryCard, LinkedRecordsCard, NotesCard } from "@/components/app/record-side-panels";
import { loadEditForm, loadMissCommitment, loadPlanText, loadRecordOverview, loadSetup, logActivityInWindow, moveStageInWindow, moveTaskToTomorrow, type EditFormData, type LineItem, type OverviewData, type SetupData } from "@/app/actions/window";
import { setTaskStatus, updateRecordFields } from "@/app/actions/records";
import type { QuickField } from "@/app/actions/quick-view";
import { fullPageHref, stepForField, type WindowView as View } from "@/lib/window-route";
import { summaryFromProposal, type SummaryRef } from "@/lib/initiative/summary";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------- Loading data for a view ----------

const cache = new Map<string, unknown>();
/** Forget what was loaded (after a change), so every view shows fresh data. */
export function clearWindowCache() {
  cache.clear();
}

/** Loads a view's data once per key (shown at once from the cache when going Back, then refreshed). */
export function useLoad<T>(key: string, loader: () => Promise<T>): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loader()
      .then((d) => {
        cache.set(key, d);
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setData({ ok: false, error: "This could not be loaded. Check the connection, then try again or open the full page." } as T);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, reload };
}

// ---------- Shared pieces ----------

export function FullPageButton({ href, variant = "outline" }: { href: string; variant?: "outline" | "default" }) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link href={href} data-full-page="" data-testid="quick-view-full-page">
        Open full page <ArrowUpRight />
      </Link>
    </Button>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}

/** The layout every view uses, with Back and Close wired to the window. */
export function ViewLayout({ askLabel, ...props }: { title: React.ReactNode; subtitle?: React.ReactNode; footer?: React.ReactNode; toolbar?: React.ReactNode; headerActions?: React.ReactNode; children: React.ReactNode; askLabel?: string }) {
  const nav = useWindowNav();
  return (
    <WindowLayout {...props} onBack={nav.canBack ? nav.back : undefined} onClose={nav.requestClose} ask={<AskAiButton compact context={askContextFor(nav.view, askLabel ?? (typeof props.title === "string" ? props.title : "this window"))} />}>
      {props.children}
    </WindowLayout>
  );
}

/** "Ask AI about this" in a window: the record it shows (record, editor), or the window's name. */
function askContextFor(v: View, label: string): ChatContext {
  const clean = label.replace(/^(Edit|Summary|Draft): /, "");
  if (v.kind === "record" || v.kind === "edit") return { table: v.table, id: v.id, label: clean };
  if (v.kind === "scenario-summary" && v.ids.length === 1) return { table: "scenarios", id: v.ids[0], label: clean };
  if (v.kind === "plan") return { table: "initiatives", id: v.initiativeId, label: clean };
  return { label: clean };
}

function LoadingView({ title = "Loading..." }: { title?: string }) {
  return (
    <ViewLayout title={<span className="text-slate-400">{title}</span>}>
      <Skeleton />
    </ViewLayout>
  );
}

function ErrorView({ error, href }: { error: string; href?: string }) {
  return (
    <ViewLayout title="Not available" footer={href ? <FullPageButton href={href} /> : null}>
      <Notice tone="warn">{error}</Notice>
    </ViewLayout>
  );
}

/** A tile of clickable lines (milestones, tasks, activity). Each line opens its record in the same window. */
function LinesTile({ title, icon: Icon, items, today, empty, action, testId }: { title: string; icon: typeof ListChecks; items: LineItem[]; today: string; empty: string; action?: React.ReactNode; testId?: string }) {
  const nav = useWindowNav();
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-white px-4 pb-3 pt-3.5" data-testid={testId}>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon aria-hidden className="h-4 w-4 text-gold" strokeWidth={1.75} />
        {title}
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular">{items.length || ""}</span>
      </h3>
      {items.length ? (
        <ul className="flex flex-col">
          {items.map((it) => {
            const done = it.status === "done" || it.status === "met";
            return (
              <li key={`${it.table}:${it.id}`}>
                <button
                  type="button"
                  onClick={() => nav.push({ kind: "record", table: it.table, id: it.id })}
                  className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn("clamp-2 text-sm", done ? "text-muted-foreground line-through" : "text-slate-900")}>
                    {it.title}
                    {it.note ? <span className="text-xs text-muted-foreground"> ({it.note})</span> : null}
                  </span>
                  <span className={cn("tabular whitespace-nowrap text-xs", done ? "text-muted-foreground" : dueClass(it.due, today) || "text-slate-600")}>{it.due ? fmtDate(it.due, "MMM d") : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-1 text-sm text-muted-foreground">{empty}</p>
      )}
      {action ? <div className="mt-1.5 border-t border-slate-100 pt-2">{action}</div> : null}
    </section>
  );
}

/** Key fields in a compact grid (label above value), long text after. */
function FieldsTile({ fields, title = "Details", className, bare = false }: { fields: QuickField[]; title?: string; className?: string; /** Inside a section that has its own title and border. */ bare?: boolean }) {
  const short = fields.filter((f) => !f.wide);
  const wide = fields.filter((f) => f.wide);
  if (!short.length && !wide.length) return null;
  return (
    <section className={cn("min-w-0", !bare && "rounded-xl border border-border bg-white px-4 pb-4 pt-3.5", className)} data-testid="quick-view-fields">
      {bare ? null : <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>}
      {short.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-3">
          {short.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="clamp-2 text-xs font-medium leading-4 text-slate-500">{f.label}</dt>
              <dd className="mt-0.5 min-w-0 break-words text-sm text-slate-900">
                {f.href ? (
                  <Link href={f.href} className="font-medium text-primary-strong underline-offset-2 hover:underline">
                    {f.text}
                  </Link>
                ) : f.status ? (
                  <StatusBadge status={f.status}>{f.text}</StatusBadge>
                ) : (
                  f.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {wide.map((f, i) => (
        <div key={i} className={cn(short.length || i ? "mt-3 border-t border-slate-100 pt-3" : "")}>
          <p className="text-xs font-medium text-slate-500">{f.label}</p>
          <p className="mt-1 max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{f.text}</p>
        </div>
      ))}
    </section>
  );
}

function ActionError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed">
      {error}
    </p>
  ) : null;
}

// ---------- The view for the address ----------

export function WindowView() {
  const { view } = useWindowNav();
  switch (view.kind) {
    case "record":
      // Tasks and commitments: the one task window (the same content from every place it is opened).
      return view.table === "tasks" || view.table === "commitments" ? <TaskWindow table={view.table} id={view.id} resolve={view.resolve ?? null} /> : <RecordWindow table={view.table} id={view.id} />;
    case "edit":
      return <EditWindow table={view.table} id={view.id} prefill={{}} />;
    case "new":
      return <EditWindow table={view.table} id={null} prefill={view.prefill} />;
    case "plan":
      return <PlanWindow initiativeId={view.initiativeId} />;
    case "draft":
      return <DraftWindow id={view.id} />;
    case "setup":
      return <SetupWindow />;
    case "work":
      return <WorkWindow />;
    case "scenario-summary":
      return <ScenarioSummaryWindow ids={view.ids} />;
    case "resolve":
      return <OlderResolveAddress missId={view.missId} />;
  }
}

/** An older `?w=resolve/<miss id>` address: opens the task window of the miss's commitment with Resolve open. */
function OlderResolveAddress({ missId }: { missId: string }) {
  const nav = useWindowNav();
  const { data } = useLoad(`miss-commitment:${missId}`, () => loadMissCommitment(missId));
  useEffect(() => {
    if (data?.ok) nav.replace({ kind: "record", table: "commitments", id: data.commitmentId, resolve: missId });
  }, [data, missId, nav]);
  if (data && !data.ok) return <ErrorView error={data.error} href="/accountability?status=missed" />;
  return <LoadingView />;
}

function RecordWindow({ table, id }: { table: string; id: string }) {
  const { data, reload } = useLoad<OverviewData>(`overview:${table}:${id}`, () => loadRecordOverview(table, id));
  const href = fullPageHref({ kind: "record", table, id });
  if (!data) return <LoadingView />;
  if (!data.ok) return <ErrorView error={data.error} href={href} />;
  switch (data.kind) {
    case "initiative":
      return <InitiativeWindow d={data} />;
    case "goal":
      return <GoalWindow d={data} reload={reload} />;
    case "pipeline":
      return <PipelineWindow d={data} reload={reload} />;
    case "scenario":
      return <ScenarioWindow d={data} />;
    case "sent-report":
      return <SentReportWindow d={data} reload={reload} />;
    default:
      return <QuickWindow d={data} reload={reload} />;
  }
}

// ---------- A sent partner report (a communication from Communication history) ----------

function SentReportWindow({ d, reload }: { d: Extract<OverviewData, { kind: "sent-report" }>; reload: () => void }) {
  const nav = useWindowNav();
  const b = d.base;
  const win = { onChanged: () => {
    reload();
    nav.refreshPage();
  } };
  const key = "window:communications-report";
  return (
    <ViewLayout title={b.title} subtitle="Partner report email" footer={<><span className="flex-1" /><FullPageButton href={b.href} variant="default" /></>}>
      <div className="flex flex-col gap-4" data-testid="quick-view-body">
        <section className="rounded-xl border border-border bg-white p-4">
          <SentReportView r={d.report} />
        </section>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <CollapsibleCard id="details" storageKey={key} title="Communication details" defaultOpen={false} summary={b.fields.slice(0, 3).map((f) => `${f.label}: ${f.text}`).join(", ")} testId="sent-report-details">
            <FieldsTile fields={b.fields} bare />
          </CollapsibleCard>
          <LinkedRecordsCard table="communications" id={b.id} data={d.linked} win={win} storageKey={key} defaultOpen={false} />
          <DocumentsCard table="communications" id={b.id} docs={d.documents} win={win} storageKey={key} defaultOpen={false} />
          <NotesCard table="communications" id={b.id} notes={d.notes} win={win} storageKey={key} defaultOpen={false} />
          <HistoryCard table="communications" history={d.history} storageKey={key} defaultOpen={false} />
        </div>
      </div>
    </ViewLayout>
  );
}

// ---------- Quick view (tasks, contacts, organizations, milestones, other records) ----------

function QuickWindow({ d, reload }: { d: Extract<OverviewData, { kind: "quick" }>; reload: () => void }) {
  const nav = useWindowNav();
  const b = d.base;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isTask = b.taskDone !== null;
  const tomorrowOk = isTask && !b.taskDone && !d.commitment;
  return (
    <ViewLayout
      title={b.title}
      subtitle={
        <span className="flex items-center gap-2">
          {b.singular}
          {d.commitment ? <Badge variant="default">Commitment</Badge> : null}
        </span>
      }
      footer={
        <>
          {isTask ? (
            <Button
              size="sm"
              variant={b.taskDone ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setTaskStatus(b.id, !b.taskDone, true);
                  reload();
                  nav.refreshPage();
                })
              }
              data-testid="quick-view-task-toggle"
            >
              {b.taskDone ? <Circle /> : <CheckCircle2 />} {pending ? "Saving..." : b.taskDone ? "Mark as not done" : "Mark as done"}
            </Button>
          ) : null}
          {tomorrowOk ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid="quick-view-tomorrow"
              onClick={() =>
                start(async () => {
                  const r = await moveTaskToTomorrow(b.id);
                  if (!r.ok) return setError(r.error);
                  reload();
                  nav.refreshPage();
                })
              }
            >
              <CalendarClock /> Move to tomorrow
            </Button>
          ) : null}
          {d.compose ? <EmailButton setup={d.compose} /> : b.email ? (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${b.email}`}>
                <Mail /> {b.email}
              </a>
            </Button>
          ) : null}
          {b.phone ? (
            <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
              <a href={`tel:${b.phone}`}>
                <Phone /> {b.phone}
              </a>
            </Button>
          ) : null}
          <span className="flex-1" />
          {b.canEdit ? (
            <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: b.table, id: b.id })} data-testid="window-edit">
              <Pencil /> Edit
            </Button>
          ) : null}
          <FullPageButton href={b.href} variant="default" />
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="quick-view-body">
        {d.suggestion ? <SuggestionLine s={d.suggestion} context={{ table: b.table, id: b.id, label: b.title }} /> : null}
        <ActionError error={error} />
        <div className={cn("grid grid-cols-1 gap-4", d.context && "lg:grid-cols-2")}>
          <NextActionCard action={b.next} today={b.today} compact />
          {d.context ? (
            <button
              type="button"
              onClick={() => nav.push({ kind: "record", table: d.context!.table, id: d.context!.id })}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-white px-4 py-3 text-left hover:border-primary-border hover:bg-primary-soft/40"
              data-testid="task-context"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-slate-600">For {d.context.singular.toLowerCase()}</span>
              <span className="clamp-2 mt-1 text-base font-semibold text-slate-900">{d.context.title}</span>
              <span className="clamp-2 mt-1 text-sm text-slate-700">Its next action: {d.context.next.text}</span>
              {d.context.next.due ? <span className={cn("tabular mt-0.5 text-xs", dueClass(d.context.next.due, b.today) || "text-slate-500")}>Due {fmtDate(d.context.next.due)}</span> : null}
            </button>
          ) : null}
        </div>
        <FieldsTile fields={b.fields} />
      </div>
    </ViewLayout>
  );
}

// ---------- Initiative overview ----------

function InitiativeWindow({ d }: { d: Extract<OverviewData, { kind: "initiative" }> }) {
  const nav = useWindowNav();
  const pick = (r: SummaryRef) => {
    if (r.kind === "record") nav.push({ kind: "record", table: r.table, id: r.id });
    else if (r.kind === "plan") nav.push({ kind: "plan", initiativeId: d.id });
  };
  return (
    <ViewLayout
      title={`Summary: ${d.title}`}
      subtitle="Select a line to open it."
      footer={
        <>
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "new", table: "goals", prefill: { initiative_id: d.id } })} data-testid="window-add-goal">
            <Plus /> Add goal
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: "initiatives", id: d.id })} data-testid="window-edit">
            <Pencil /> Edit
          </Button>
          <FullPageButton href={`/records/initiatives/${d.id}`} variant="default" />
        </>
      }
    >
      <SummaryContent s={d.summary} pick={pick} aside={<NextActionCard action={d.next} today={d.today} compact />} />
    </ViewLayout>
  );
}

function PlanWindow({ initiativeId }: { initiativeId: string }) {
  const { data } = useLoad(`plan:${initiativeId}`, () => loadPlanText(initiativeId));
  if (!data) return <LoadingView />;
  if (!data.ok) return <ErrorView error={data.error} href={`/records/initiatives/${initiativeId}`} />;
  return (
    <ViewLayout title={data.title} subtitle="Plan document" footer={<FullPageButton href={`/records/initiatives/${initiativeId}`} />}>
      <AiText text={data.body} className="max-w-[75ch]" />
    </ViewLayout>
  );
}

// ---------- Goal overview ----------

function GoalWindow({ d, reload }: { d: Extract<OverviewData, { kind: "goal" }>; reload: () => void }) {
  const nav = useWindowNav();
  const b = d.base;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = b.fields.find((f) => f.label === "Status")?.text ?? "";
  const shown = b.fields.filter((f) => f.label !== "Initiative");
  return (
    <ViewLayout
      title={b.title}
      subtitle={d.initiative ? `Goal in ${d.initiative.title}` : "Goal"}
      footer={
        <>
          {status !== "Met" ? (
            <Button
              size="sm"
              disabled={pending}
              data-testid="goal-mark-met"
              onClick={() =>
                start(async () => {
                  const r = await updateRecordFields("goals", b.id, { status: "met" });
                  if (!r.ok) return setError(r.error);
                  reload();
                  nav.refreshPage();
                })
              }
            >
              <CheckCircle2 /> {pending ? "Saving..." : "Mark as met"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "new", table: "milestones", prefill: { goal_id: b.id } })}>
            <Plus /> Add milestone
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: "goals", id: b.id })} data-testid="window-edit">
            <Pencil /> Edit
          </Button>
          <FullPageButton href={b.href} variant="default" />
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="goal-overview">
        {d.suggestion ? <SuggestionLine s={d.suggestion} context={{ table: "goals", id: b.id, label: b.title }} /> : null}
        <ActionError error={error} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(14rem,18rem)]">
          <NextActionCard action={b.next} today={b.today} compact />
          <FieldsTile fields={shown} className="xl:order-none" />
          <section className="flex flex-col justify-center rounded-xl border border-border bg-white px-4 py-3 md:col-span-2 xl:col-span-1" data-testid="goal-progress">
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
              Measured now
              {d.progress?.met === true ? <StatusBadge status="met">Met now</StatusBadge> : d.progress?.met === false ? <StatusBadge status="neutral">Not met yet</StatusBadge> : null}
            </span>
            <span className="tabular mt-1 text-3xl font-semibold leading-none text-slate-900">{d.progress?.current ?? "Not measured"}</span>
            <span className="mt-1 text-xs text-slate-600">
              Target {d.progress?.target ?? "not set"}. {d.progress?.rule ?? ""}
            </span>
            {d.initiative ? (
              <button type="button" className="mt-2 self-start text-sm font-medium text-primary-strong hover:underline" onClick={() => nav.push({ kind: "record", table: "initiatives", id: d.initiative!.id })}>
                Initiative: {d.initiative.title}
              </button>
            ) : null}
          </section>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          <LinesTile title="Milestones" icon={CalendarDays} items={d.milestones} today={b.today} empty="No milestones yet." />
          <LinesTile title="Tasks" icon={ListChecks} items={d.tasks} today={b.today} empty="No tasks linked to this goal." />
        </div>
      </div>
    </ViewLayout>
  );
}

// ---------- Pipeline item overview ----------

function PipelineWindow({ d, reload }: { d: Extract<OverviewData, { kind: "pipeline" }>; reload: () => void }) {
  const nav = useWindowNav();
  const b = d.base;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stage, setStage] = useState(d.nextStage?.id ?? d.stageId);
  const [method, setMethod] = useState("email");
  const [purpose, setPurpose] = useState("");
  const [summary, setSummary] = useState("");
  const open = d.itemStatus === "open";
  const isAcq = d.pipeline.kind === "acquisition";
  const stageName = d.stages.find((s) => s.id === d.stageId)?.name ?? "";
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      setError(null);
      setMessage(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Not saved.");
      if (r.message) setMessage(r.message);
      reload();
      nav.refreshPage();
    });
  const shown = b.fields.filter((f) => !["Pipeline", "Stage", "Next action", "Next action due"].includes(f.label));
  return (
    <ViewLayout
      title={b.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {d.pipeline.name}, {stageName}
          {isAcq ? <DealSourceBadge type={d.dealType} /> : null}
        </span>
      }
      footer={
        <>
          {d.compose ? <EmailButton setup={d.compose} /> : null}
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: "pipeline_items", id: b.id })} data-testid="window-edit">
            <Pencil /> Edit
          </Button>
          <FullPageButton href={b.href} variant="default" />
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="pipeline-overview">
        {d.suggestion ? <SuggestionLine s={d.suggestion} context={{ table: "pipeline_items", id: b.id, label: b.title }} /> : null}
        <ActionError error={error} />
        {message ? <Notice tone="success">{message}</Notice> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-2">
            <NextActionCard action={b.next} today={b.today} compact />
            {open && b.next.due ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => updateRecordFields("pipeline_items", b.id, { next_action_due: d.tomorrow }))} data-testid="pipeline-tomorrow">
                  <CalendarClock /> Move to tomorrow
                </Button>
                <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: "pipeline_items", id: b.id })} data-testid="pipeline-next-action">
                  Done: set the next one
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <ItemStatusBadges status={d.status ?? undefined} itemStatus={d.itemStatus} />
            </div>
          </div>
          {/* Top right: the deal scorecard (second on tablets and phones, third on wide screens). */}
          <DealScorecard card={d.scorecard} className="min-w-0 xl:order-last" />
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white px-4 pb-4 pt-3.5 md:col-span-2 xl:col-span-1" data-testid="pipeline-move-stage">
            <h3 className="text-sm font-semibold text-slate-900">Move stage</h3>
            <p className="text-xs text-slate-600">
              Now in <span className="font-medium text-slate-800">{stageName}</span>.{" "}
              {d.nextStage ? (d.nextStage.missing.length ? `Needed before ${d.nextStage.name}: ${d.nextStage.missing.join(", ")}.` : `Nothing missing for ${d.nextStage.name}.`) : "No later stage."}
            </p>
            <div className="flex gap-2">
              <NativeSelect value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage" className="min-w-0 flex-1" disabled={!open}>
                {d.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              <Button size="sm" className="h-9 shrink-0" disabled={pending || !open || stage === d.stageId} onClick={() => act(() => moveStageInWindow(b.id, stage))} data-testid="pipeline-move">
                Move
              </Button>
            </div>
          </section>

        </div>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FieldsTile fields={shown} className="md:col-span-2 xl:col-span-1" />
          <LinesTile title="Tasks for this item" icon={ListChecks} items={d.stageTasks} today={b.today} empty="No tasks for this item." />
          <div className="flex min-w-0 flex-col gap-4">
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white px-4 pb-4 pt-3.5" data-testid="pipeline-log-activity">
            <h3 className="text-sm font-semibold text-slate-900">Log activity</h3>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} aria-label="How">
                <option value="email">Email</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="text">Text</option>
                <option value="other">Other</option>
              </NativeSelect>
              {isAcq ? (
                <NativeSelect value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="What it was">
                  <option value="">Other activity</option>
                  <option value="cim_request">CIM requested</option>
                  <option value="source_contact">Contacted the deal source</option>
                </NativeSelect>
              ) : null}
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened, in one line" aria-label="What happened" className={cn(!isAcq && "col-span-1", isAcq && "col-span-2")} maxLength={2000} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={pending || (!summary.trim() && !purpose)}
              data-testid="pipeline-log"
              onClick={() =>
                act(async () => {
                  const r = await logActivityInWindow({ itemId: b.id, method, summary, purpose });
                  if (r.ok) {
                    setSummary("");
                    setPurpose("");
                  }
                  return r;
                })
              }
            >
              <MessageSquare /> Log activity
            </Button>
          </section>
            <LinesTile title="Recent activity" icon={MessageSquare} items={d.activity} today={b.today} empty="No activity logged yet." />
            {d.people.length ? (
              <section className="rounded-xl border border-border bg-white px-4 pb-3 pt-3.5">
                <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Users aria-hidden className="h-4 w-4 text-gold" strokeWidth={1.75} /> People
                </h3>
                <ul className="flex flex-col">
                  {d.people.map((p) => (
                    <li key={`${p.label}:${p.id}`}>
                      <button type="button" onClick={() => nav.push({ kind: "record", table: p.table, id: p.id })} className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-primary-soft">
                        <span className="text-xs text-slate-500">{p.label}</span>
                        <span className="clamp-1 text-sm font-medium text-slate-900">{p.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </ViewLayout>
  );
}

// ---------- Scenario overview ----------

function ScenarioWindow({ d }: { d: Extract<OverviewData, { kind: "scenario" }> }) {
  const nav = useWindowNav();
  return (
    <ViewLayout
      title={d.title}
      subtitle="Scenario"
      footer={
        <>
          <Button size="sm" onClick={() => nav.push({ kind: "scenario-summary", ids: [d.id] })} data-testid="scenario-view-summary">
            <LayoutGrid /> View summary
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: "scenarios", id: d.id })} data-testid="window-edit">
            <Pencil /> Rename or change months
          </Button>
          <FullPageButton href={`/plan/scenarios/${d.id}`} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-[75ch] text-sm text-slate-700">{d.description} Charts and number changes are on the full page.</p>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-white">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
              <span>Result</span>
              <span className="text-right">Current numbers</span>
              <span className="clamp-1 text-right">{d.title}</span>
            </div>
            {d.results.map((r) => (
              <div key={r.label} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0">
                <span className="text-slate-700">{r.label}</span>
                <span className="tabular text-right text-slate-900">{r.current}</span>
                <span className="tabular text-right font-medium text-slate-900">{r.scenario}</span>
              </div>
            ))}
          </section>
          <section className="min-w-0 rounded-xl border border-border bg-white px-4 pb-3 pt-3.5">
            <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Numbers changed</h3>
            {d.changes.length ? (
              <ul className="flex flex-col">
                {d.changes.map((c) => (
                  <li key={c.label}>
                    {c.table && c.id ? (
                      <button type="button" onClick={() => nav.push({ kind: "record", table: c.table!, id: c.id! })} className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md px-2 py-1.5 text-left hover:bg-primary-soft">
                        <span className="clamp-2 text-sm text-slate-900">{c.label}</span>
                        <span className="tabular text-sm font-medium">{c.value}</span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5">
                        <span className="clamp-2 text-sm text-slate-900">{c.label}</span>
                        <span className="tabular text-sm font-medium">{c.value}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No numbers changed yet. Change them on the full page.</p>
            )}
          </section>
        </div>
      </div>
    </ViewLayout>
  );
}

// ---------- Editor ----------

function EditWindow({ table, id, prefill }: { table: string; id: string | null; prefill: Record<string, string> }) {
  const nav = useWindowNav();
  const key = `edit:${table}:${id ?? `new:${new URLSearchParams(prefill).toString()}`}`;
  const { data } = useLoad<EditFormData>(key, () => loadEditForm(table, id, prefill));
  const view: View = id ? { kind: "edit", table, id } : { kind: "new", table, prefill };
  // "Save and close" (closing with unsaved changes) submits this form.
  useEffect(() => {
    nav.setSaver(async () => {
      const form = document.querySelector<HTMLFormElement>("[data-url-window] form[data-window-form]");
      if (!form) return false;
      if (!form.checkValidity()) {
        form.reportValidity();
        return false;
      }
      return new Promise<boolean>((resolve) => {
        pendingSave = resolve;
        form.requestSubmit(form.querySelector<HTMLElement>("[data-save-and-leave]") ?? undefined);
      });
    });
    return () => nav.setSaver(null);
  }, [nav]);
  if (!data) return <LoadingView title={id ? "Edit" : "Add"} />;
  if (!data.ok) return <ErrorView error={data.error} href={fullPageHref(view)} />;
  return (
    <ViewLayout title={id ? `Edit: ${data.title}` : data.title} subtitle={id ? data.singular : "New record"} headerActions={<FullPageButton href={fullPageHref(view)} />}>
      <RecordForm
        table={data.table}
        id={data.id}
        initial={data.initial}
        refOptions={data.refOptions}
        hide={data.hide}
        require={data.require}
        text={data.text}
        excludeOptions={data.excludeOptions}
        extraHidden={data.extraHidden}
        showSaveRule={table === "transactions"}
        inWindow={{
          onSaved: (r) => {
            clearWindowCache();
            const resolve = pendingSave;
            pendingSave = null;
            if (resolve) {
              // "Save and close": the window closes after the save, then the page underneath reloads.
              resolve(true);
              setTimeout(() => nav.refreshPage(), 0);
              return;
            }
            if (id) nav.afterSave(table, r.id);
            else {
              nav.replace({ kind: "record", table, id: r.id });
              nav.refreshPage();
            }
          },
          onCancel: nav.back,
          onFailed: () => {
            const resolve = pendingSave;
            pendingSave = null;
            resolve?.(false);
          },
        }}
      />
    </ViewLayout>
  );
}
let pendingSave: ((ok: boolean) => void) | null = null;

// ---------- Initiative draft overview ----------

function DraftWindow({ id }: { id: string }) {
  const nav = useWindowNav();
  const { data } = useLoad<SetupData>(`setup:${id}`, () => loadSetup(id));
  if (!data) return <LoadingView />;
  if (!data.ok) return <ErrorView error={data.error} href={`/plan/initiatives/drafts/${id}`} />;
  if (data.status !== "draft") {
    return (
      <ViewLayout title="Initiative draft" footer={data.resultHref ? <Button asChild size="sm"><Link href={data.resultHref}>Open what was created <ArrowRight /></Link></Button> : null}>
        <Notice>{data.status === "approved" ? "This draft was approved and its records were created." : "This draft was discarded. Nothing was created."}</Notice>
      </ViewLayout>
    );
  }
  const p = data.state.proposal;
  const budgetCurrent = p.budget_change ? data.categorySpend[p.budget_change.category.toLowerCase()] ?? null : null;
  const summary = summaryFromProposal(p, data.state.include, budgetCurrent);
  const pick = (r: SummaryRef) => {
    if (r.kind === "field") nav.push({ kind: "setup", draftId: id, step: stepForField(r.anchor) });
    else if (r.kind === "plan") nav.push({ kind: "setup", draftId: id, step: "plan" });
  };
  return (
    <ViewLayout
      title={`Draft: ${p.initiative.name || "New initiative"}`}
      subtitle="Nothing is created until you approve. Select a line to change it."
      footer={
        <>
          <span className="flex-1" />
          <FullPageButton href={`/plan/initiatives/drafts/${id}`} />
          <Button size="sm" onClick={() => nav.push({ kind: "setup", draftId: id, step: "review" })} data-testid="draft-continue">
            Review and approve <ArrowRight />
          </Button>
        </>
      }
    >
      <SummaryContent s={summary} pick={pick} />
    </ViewLayout>
  );
}

// Shared with the setup and work views.
export { ActionError, ErrorView, FieldsTile, LinesTile, LoadingView, Skeleton };
