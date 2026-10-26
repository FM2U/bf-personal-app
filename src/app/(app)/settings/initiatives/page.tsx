import Link from "next/link";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { hasPipelineUpdate } from "@/lib/pipeline";
import { requiredFieldLabel } from "@/lib/calc/pipeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Notice, PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { ConfirmSubmit, SubmitButton } from "@/components/app/submit-button";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { deleteStageTask, moveStageTask, saveStageLimit } from "@/app/actions/pipeline";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Initiatives and pipelines" };

const OUTCOME: Record<string, string> = { open: "Open", won: "Closed, won", lost: "Closed, passed" };

const TASK_GRID = "md:grid-cols-[4.5rem_minmax(0,1fr)_6.5rem_7rem_6.5rem_9.5rem]";

export default async function InitiativesSettingsPage({ searchParams }: { searchParams: Promise<{ pipeline?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const [{ data: pipesData }, available] = await Promise.all([supabase.from("pipelines").select("id,name,kind").order("sort_order"), hasPipelineUpdate(supabase)]);
  const pipes = (pipesData ?? []) as Row[];
  const selected = pipes.find((p) => p.id === sp.pipeline) ?? pipes[0];
  const [{ data: stagesData }, { data: tasksData }] = await Promise.all([
    selected ? supabase.from("pipeline_stages").select("*").eq("pipeline_id", selected.id).order("position") : Promise.resolve({ data: [] }),
    selected && available ? supabase.from("stage_tasks").select("*").order("sort_order").order("title") : Promise.resolve({ data: [] }),
  ]);
  const stages = (stagesData ?? []) as Row[];
  const tasks = (tasksData ?? []) as Row[];
  const here = selected ? `/settings/initiatives?pipeline=${selected.id}` : "/settings/initiatives";

  return (
    <div>
      <PageHeader
        title="Initiatives and pipelines"
        description="Add or edit initiatives, pipelines, and stages. Each stage has a task list (created for an item when it enters the stage), a time limit, and the details required before an item can enter it."
      />
      <div className="flex flex-col gap-4">
        {sp.notice ? <Notice tone={sp.notice.startsWith("Not saved") || sp.notice.startsWith("Database update") ? "warn" : "success"}>{sp.notice}</Notice> : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ListCard sb={supabase} table="initiatives" columns={["name", "sort_order", "is_active"]} />
          <ListCard sb={supabase} table="pipelines" columns={["name", "initiative_id", "kind", "is_active"]} />
        </div>

        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Stages, task lists, time limits, and required details</CardTitle>
              <CardDescription>
                Entering a stage creates its tasks for the item. The task marked &quot;Next action&quot; becomes the item&apos;s next action. An item in a stage longer than the time limit opens a decision: advance, pass, or extend.
              </CardDescription>
            </div>
            <nav className="flex flex-wrap gap-1.5" aria-label="Pipeline">
              {pipes.map((p) => (
                <Button key={p.id} asChild size="sm" variant={p.id === selected?.id ? "default" : "outline"}>
                  <Link href={`/settings/initiatives?pipeline=${p.id}`}>{p.name}</Link>
                </Button>
              ))}
            </nav>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!available ? <DbUpdateNotice compact /> : null}
            {selected && !available ? (
              <ListCard sb={supabase} table="pipeline_stages" title={`${selected.name}: stages`} filters={[["pipeline_id", "eq", selected.id]]} prefill={{ pipeline_id: selected.id }} columns={["name", "position", "outcome"]} />
            ) : null}
            {selected && available
              ? stages.map((s) => {
                  const list = tasks.filter((t) => t.pipeline_stage_id === s.id);
                  const required = (Array.isArray(s.required_fields) ? s.required_fields : []) as string[];
                  return (
                    <section key={s.id} className="rounded-lg border border-border" aria-label={`Stage ${s.name}`}>
                      <div className="grid grid-cols-1 items-center gap-3 border-b border-border bg-slate-50/70 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1.3fr)_auto]">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="tabular w-5 shrink-0 text-xs text-muted-foreground">{s.position}.</span>
                          <span className="clamp-1 font-medium text-slate-900">{s.name}</span>
                          <Badge variant={s.outcome === "open" ? "outline" : "neutral"}>{OUTCOME[s.outcome] ?? s.outcome}</Badge>
                          {s.counts_as_signed ? <Badge variant="success">Signed work</Badge> : null}
                          {s.default_probability_pct !== null && s.default_probability_pct !== undefined ? (
                            <span className="tabular shrink-0 text-xs text-muted-foreground">{s.default_probability_pct}% chance</span>
                          ) : null}
                        </div>
                        {s.outcome === "open" ? (
                          <GuardedForm action={saveStageLimit} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="back" value={here} />
                            <label htmlFor={`limit-${s.id}`} className="shrink-0 text-xs text-muted-foreground">
                              Time limit
                            </label>
                            <Input id={`limit-${s.id}`} name="max_days_in_stage" type="number" min={1} max={365} defaultValue={s.max_days_in_stage ?? ""} placeholder="None" className="h-8 w-16" />
                            <span className="text-xs text-muted-foreground">days</span>
                            <SubmitButton size="sm" variant="outline" className="h-8">
                              Save
                            </SubmitButton>
                          </GuardedForm>
                        ) : (
                          <span className="text-xs text-muted-foreground">No time limit (closed stage)</span>
                        )}
                        <p className="clamp-2 text-xs text-slate-700">
                          <span className="text-muted-foreground">Required before entering: </span>
                          {required.length ? required.map(requiredFieldLabel).join(", ") : "nothing"}
                        </p>
                        <Button asChild size="sm" variant="ghost" className="h-8 justify-self-start md:justify-self-end">
                          <Link href={`/records/pipeline_stages/${s.id}?edit=1`}>
                            <Pencil /> Edit stage
                          </Link>
                        </Button>
                      </div>
                      <div className="px-3 py-2">
                        <div className={cn("hidden gap-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid", TASK_GRID)}>
                          <span>Order</span>
                          <span>Task</span>
                          <span>Due</span>
                          <span>Next action</span>
                          <span>Commitment</span>
                          <span className="text-right">Actions</span>
                        </div>
                        {list.length ? (
                          <ul className="flex flex-col divide-y divide-slate-100">
                            {list.map((t, i) => (
                              <li key={t.id} className={cn("grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1.5", TASK_GRID)}>
                                <div className="flex gap-1">
                                  <GuardedForm action={moveStageTask}>
                                    <input type="hidden" name="id" value={t.id} />
                                    <input type="hidden" name="dir" value="up" />
                                    <input type="hidden" name="back" value={here} />
                                    <Button type="submit" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} aria-label={`Move "${t.title}" up`}>
                                      <ArrowUp />
                                    </Button>
                                  </GuardedForm>
                                  <GuardedForm action={moveStageTask}>
                                    <input type="hidden" name="id" value={t.id} />
                                    <input type="hidden" name="dir" value="down" />
                                    <input type="hidden" name="back" value={here} />
                                    <Button type="submit" size="icon" variant="ghost" className="h-7 w-7" disabled={i === list.length - 1} aria-label={`Move "${t.title}" down`}>
                                      <ArrowDown />
                                    </Button>
                                  </GuardedForm>
                                </div>
                                <span className="clamp-2 text-sm text-slate-900">{t.title}</span>
                                <span className="tabular col-start-2 text-xs text-slate-700 md:col-start-auto md:text-sm">
                                  <span className="md:hidden">Due: </span>
                                  {Number(t.due_in_days) === 0 ? "Same day" : `${t.due_in_days} ${Number(t.due_in_days) === 1 ? "day" : "days"}`}
                                </span>
                                <span className="col-start-2 md:col-start-auto">{t.is_next_action_default ? <Badge variant="default">Next action</Badge> : <span className="text-xs text-muted-foreground md:text-sm">
                                      <span className="md:hidden">Next action: </span>No
                                    </span>}</span>
                                <span className="col-start-2 text-xs text-slate-700 md:col-start-auto md:text-sm">
                                  <span className="md:hidden">Commitment: </span>
                                  {t.is_commitment ? "Yes" : "No"}
                                </span>
                                <div className="col-start-2 flex gap-1 md:col-start-auto md:justify-end">
                                  <Button asChild size="sm" variant="ghost" className="h-7">
                                    <Link href={`/records/stage_tasks/${t.id}?edit=1`}>Edit</Link>
                                  </Button>
                                  <GuardedForm action={deleteStageTask}>
                                    <input type="hidden" name="id" value={t.id} />
                                    <input type="hidden" name="back" value={here} />
                                    <ConfirmSubmit size="sm" variant="ghost" className="h-7 text-status-missed" message={`Delete the stage task "${t.title}"? Tasks already created for items stay.`}>
                                      Delete
                                    </ConfirmSubmit>
                                  </GuardedForm>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-1.5 text-sm text-muted-foreground">No tasks for this stage.</p>
                        )}
                        <Button asChild size="sm" variant="outline" className="mt-1.5 h-7">
                          <Link href={`/records/stage_tasks/new?pipeline_stage_id=${s.id}&sort_order=${list.length + 1}&__redirect=${encodeURIComponent(here)}`}>
                            <Plus /> Add task to {s.name}
                          </Link>
                        </Button>
                      </div>
                    </section>
                  );
                })
              : null}
            {selected && available ? (
              <Button asChild size="sm" variant="outline" className="self-start">
                <Link href={`/records/pipeline_stages/new?pipeline_id=${selected.id}&position=${stages.length + 1}`}>
                  <Plus /> Add stage to {selected.name}
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
