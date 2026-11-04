import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { date as fmtDate } from "@/lib/format";
import { feeLabel } from "@/lib/work/pipelines";
import { loadItemPage, type ItemKind } from "@/lib/work/pipelines-data";
import { headerFigures } from "@/lib/work/record-page";
import { daysLabel } from "@/lib/work/stages";
import { openTodos } from "@/lib/work/todos";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { itemAsk } from "@/lib/work/ask-ai";
import { ConsultingFactsCard, FindOutCard, ItemDecisionCard, ItemHeaderActions, ItemNextActionCard, ItemTasksCard, ItemTimelineCard, OpportunityFactsCard } from "@/components/app/work/item/cards";
import { RecordHeader } from "@/components/app/work/record-header";
import { RecordColumns } from "@/components/app/work/record-columns";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Figure, Pill, waitTone, What, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

/**
 * The opportunity page (/work/jobs/[id]) and the consulting page (/work/consulting/[id]) under the record-page rule
 * (batch B2, approved 2026-10-31): breadcrumb to the list with the stage, the title (consulting: "Client · Project"),
 * buttons Email, Log a call, Advance, Close, Ask AI; the status strip with the lane pill, the stage pill with the day
 * in stage, the role or contact line, and the figures (consulting: FEE first) NEXT ACTION, OPEN TASKS, LAST CONTACT
 * (or WAITING). Left: What to find out (opportunity), Next action, Tasks. Right: Facts, Timeline, Decision.
 */
export async function ItemPage({ kind, id }: { kind: ItemKind; id: string }) {
  const { supabase, ownerId } = await requireOwner();
  const listHref = kind === "job" ? "/work/jobs" : "/work/consulting";
  const listName = kind === "job" ? "Job search" : "Consulting";
  const testId = kind === "job" ? "work-opportunity" : "work-consulting-item";
  const crumbLink = (
    <Link href={listHref} className="text-primary-strong hover:underline" data-testid="item-crumb">
      {listName}
    </Link>
  );
  const notice = null;
  if (notice) {
    return (
      <WorkShell testId={testId}>
        <WorkHeader title={kind === "job" ? "Opportunity" : "Consulting"} crumb={crumbLink} />
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const d = await loadItemPage(supabase, ownerId, kind, id);
  const item = d.item;
  if (!item) {
    return (
      <WorkShell testId={testId}>
        <WorkHeader title={kind === "job" ? "Opportunity" : "Consulting"} crumb={crumbLink} />
        <EmptyState
          title={kind === "job" ? "This opportunity was not found." : "This consulting item was not found."}
          body="It may have been deleted, or it belongs to another pipeline."
          action={
            <Button asChild size="sm">
              <Link href={listHref}>Back to {listName}</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const waiting = item.status === "open" && item.waitLevel !== "none";
  const figures = headerFigures(
    { nextDue: item.nextActionDue, hasNext: !!item.nextAction, nextLabel: "Next action", openTasks: openTodos(d.todos).length, lastContactAt: d.lastContact?.on ?? null, lastContactKind: d.lastContact?.kind ?? null, waitingOn: waiting ? item.waitingOn : null, waitDays: item.waitDays, waitTone: item.waitLevel },
    d.today,
    (x) => fmtDate(x, "MMM d"),
  );
  const line = kind === "job" ? [item.title, item.whatItDoes, item.location].filter(Boolean).join(" · ") : [item.contactName, item.scope ? item.scope.slice(0, 80) : item.title].filter(Boolean).join(" · ");
  return (
    <WorkShell testId={testId}>
      <RecordHeader
        title={kind === "consulting" && item.title ? `${item.name} · ${item.title}` : item.name}
        crumb={
          <>
            {crumbLink}
            <span className="mx-1.5 text-slate-400">›</span>
            {item.stageName ?? "No stage"}
          </>
        }
        actions={
          <>
            <ItemHeaderActions item={item} compose={d.compose} advanceTo={item.status === "open" ? d.advanceTo : null} closeTo={d.closeTo} today={d.today} tz={d.tz} />
            <AskAiPill context={itemAsk(item)} compose={d.compose} />
          </>
        }
        testId="item-status-line"
        status={
          <>
            <Pill tone={kind === "job" ? "blue" : "gray"} testId="item-lane-pill">
              {listName}
            </Pill>
            <Pill tone={item.status === "open" ? "stage" : item.status === "won" ? "green" : "charcoal"} testId="item-stage-pill">
              {item.stageName ?? "No stage"}
              {item.status === "open" ? ` · day ${item.dayInStage}` : ""}
            </Pill>
            {waiting ? (
              <Pill tone={waitTone(item.waitLevel)} className="tabular" testId="item-wait-pill">
                Waiting on {item.waitingOn} · {daysLabel(item.waitDays)}
              </Pill>
            ) : null}
            {line ? <What>{line}</What> : null}
          </>
        }
        figures={figures}
        before={kind === "consulting" ? <Figure value={feeLabel(item.fee, item.stageName)} label="Fee" testId="figure-fee" /> : null}
      />
      <RecordColumns
        left={
          <>
          {kind === "job" ? <FindOutCard item={item} /> : null}
          <ItemNextActionCard item={item} today={d.today} />
          <ItemTasksCard item={item} tasks={d.todos} today={d.today} />
          </>
        }
        right={
          <>
          {kind === "job" ? <OpportunityFactsCard item={item} /> : <ConsultingFactsCard item={item} />}
          <ItemTimelineCard item={item} events={d.timeline} />
          <ItemDecisionCard item={item} advanceTo={item.status === "open" ? d.advanceTo : null} closeTo={d.closeTo} />
          </>
        }
      />
    </WorkShell>
  );
}
