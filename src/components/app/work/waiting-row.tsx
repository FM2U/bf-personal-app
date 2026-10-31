"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { resetWaiting } from "@/app/actions/work";
import { date as fmtDate } from "@/lib/format";
import type { ComposeSetup } from "@/lib/compose-email";
import { chaseDraft, daysLabel } from "@/lib/work/stages";
import type { DealRow } from "@/lib/work/data";
import { Line1, Line2, Name, Pill, RowButton, RowShell, waitTone, What } from "@/components/app/work/ui";

/**
 * One row of "Waiting on someone": the deal, what is waited on and who, since when, the days pill (amber at the
 * threshold, red at double), and Chase, which opens the email editor with a drafted follow-up to the deal's main
 * contact. Sending logs the email on the deal (the existing send path) and starts the wait again from today.
 */
export function WaitingRow({ deal, compose }: { deal: DealRow; compose: ComposeSetup }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const draft = chaseDraft({ dealName: deal.name, waitingOn: deal.waitingOn, contactName: deal.contactName, days: deal.waitDays });
  return (
    <RowShell
      testId="waiting-row"
      dataAttrs={{ "data-deal": deal.id }}
      stack
      right={
        <>
          <span className="text-xs text-muted-foreground" data-testid="waiting-since">
            {deal.waitingSince ? `Since ${fmtDate(deal.waitingSince, "MMM d")}` : ""}
          </span>
          <Pill tone={waitTone(deal.waitLevel)} className="tabular" testId="waiting-days">
            {daysLabel(deal.waitDays)}
          </Pill>
          {sent ? (
            <Pill tone="green" testId="chase-sent">
              Sent. The wait starts again today.
            </Pill>
          ) : (
            <RowButton tone="gold" onClick={() => setOpen(true)} data-testid="chase-button">
              Chase
            </RowButton>
          )}
        </>
      }
    >
      <Line1>
        <Link href={`/work/deals/${deal.id}`} className="hover:underline">
          <Name>{deal.name}</Name>
        </Link>
        <What>{[deal.stageName, deal.location].filter(Boolean).join(" · ")}</What>
      </Line1>
      <Line2>
        {deal.waitingOn}
        {deal.contactName ? ` · ${deal.contactName}${deal.brokerName && !deal.brokerName.includes(deal.contactName) ? `, ${deal.brokerName}` : ""}` : deal.brokerName ? ` · ${deal.brokerName}` : ""}
      </Line2>
      {open ? (
        <ComposeEmailDialog
          setup={compose}
          open={open}
          onOpenChange={setOpen}
          initial={draft}
          onSent={async () => {
            await resetWaiting(deal.id);
            setSent(true);
            router.refresh();
          }}
        />
      ) : null}
    </RowShell>
  );
}
