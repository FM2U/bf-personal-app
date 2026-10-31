import { date as fmtDate } from "@/lib/format";
import { moneyShort } from "@/lib/work/buy-box";
import type { DealRow } from "@/lib/work/data";
import { daysLabel, dueLabel } from "@/lib/work/stages";
import { Due, Line1, Line2, Line3, Name, Pill, RowShell, Stat, waitTone, What } from "@/components/app/work/ui";

/** One deal row on Deals: name, what it does, the action with its due date, the key finding; EBITDA and location; the wait pill. */
export function DealListRow({ deal, today }: { deal: DealRow; today: string }) {
  const due = deal.nextAction ? dueLabel(deal.nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  const waiting = deal.waitLevel !== "none" && deal.status === "open";
  return (
    <RowShell
      href={`/work/deals/${deal.id}`}
      testId="deal-row"
      dataAttrs={{ "data-deal": deal.id }}
      right={
        <>
          <Stat value={deal.earnings === null ? "No figure" : `${moneyShort(deal.earnings)}${deal.earningsLabel === "SDE" ? " SDE" : ""}`} label={deal.location ?? "No location"} />
          {waiting ? (
            <Pill tone={waitTone(deal.waitLevel)} className="tabular" testId="deal-wait">
              {daysLabel(deal.waitDays)}
              {deal.contactName ? ` · ${shortName(deal.contactName)}` : ""}
            </Pill>
          ) : (
            <Pill tone="quiet" testId="deal-wait">
              Not waiting
            </Pill>
          )}
        </>
      }
    >
      <Line1>
        <Name>{deal.name}</Name>
        {deal.whatItDoes ? <What>{deal.whatItDoes}</What> : null}
      </Line1>
      <Line2 className="text-slate-900">
        {deal.status !== "open" ? (
          <span className="text-muted-foreground">{deal.stageName === "Passed" ? `Passed: ${deal.passReasonLabel ?? "no reason recorded"}` : deal.stageName === "Lost" ? "Lost" : "Closed"}{deal.stageEnteredAt ? ` · ${fmtDate(deal.stageEnteredAt, "MMM d")}` : ""}</span>
        ) : deal.nextAction ? (
          <>
            {deal.nextAction}
            {due ? (
              <>
                {" "}
                <span className="text-muted-foreground">·</span> <Due text={waiting && due.tone === "later" ? "waiting" : due.text} tone={waiting && due.tone === "later" ? "none" : due.tone} />
                {deal.nextActionMinutes ? <Due text={`· ${deal.nextActionMinutes} min`} tone={due.tone} className="ml-1" /> : null}
              </>
            ) : null}
          </>
        ) : (
          <Pill tone="amber" testId="needs-action">
            Needs a next action
          </Pill>
        )}
      </Line2>
      {deal.keyFinding ? <Line3>{deal.keyFinding}</Line3> : null}
    </RowShell>
  );
}

/** "R. Kim" from "Rachel Kim". */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0].charAt(0)}. ${parts[parts.length - 1]}`;
}
