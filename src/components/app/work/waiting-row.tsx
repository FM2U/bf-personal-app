"use client";

import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { daysLabel } from "@/lib/work/stages";
import type { DealRow } from "@/lib/work/data";
import { Line1, Line2, Name, Pill, RowButton, RowShell, waitTone } from "@/components/app/work/ui";

/**
 * One row of "Waiting on someone": the deal, what is waited on and who, since when and the stage, the days pill
 * (amber at the threshold, red at double), and Follow up, which opens the email editor with a drafted follow-up to
 * the deal's main contact (the editor is held by the Home board, so it stays open while the row moves to another
 * section after the send). Sending logs the email on the deal (the existing send path) and starts the wait again
 * from today ("Followed up").
 */
export function WaitingRow({ deal, followedUp, onFollowUp }: { deal: DealRow; followedUp: boolean; onFollowUp: () => void }) {
  return (
    <RowShell
      testId="waiting-row"
      dataAttrs={{ "data-deal": deal.id }}
      stack
      right={
        <>
          <span className="text-xs text-muted-foreground" data-testid="waiting-since">
            {[deal.waitingSince ? `Since ${fmtDate(deal.waitingSince, "MMM d")}` : null, deal.stageName].filter(Boolean).join(" · ")}
          </span>
          {followedUp ? (
            <Pill tone="green" testId="follow-up-sent">
              Followed up. The wait starts again today.
            </Pill>
          ) : (
            <RowButton tone="gold" onClick={onFollowUp} className="ml-auto" data-testid="follow-up-button">
              Follow up
            </RowButton>
          )}
        </>
      }
    >
      <Line1>
        <Link href={`/work/deals/${deal.id}`} className="hover:underline">
          <Name>{deal.name}</Name>
        </Link>
        <Pill tone={waitTone(deal.waitLevel)} className="tabular" testId="waiting-days">
          {daysLabel(deal.waitDays)}
        </Pill>
      </Line1>
      <Line2>
        {deal.waitingOn}
        {deal.contactName ? ` · ${deal.contactName}${deal.brokerName && !deal.brokerName.includes(deal.contactName) ? `, ${deal.brokerName}` : ""}` : deal.brokerName ? ` · ${deal.brokerName}` : ""}
      </Line2>
    </RowShell>
  );
}
