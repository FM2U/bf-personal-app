"use client";

import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { daysLabel } from "@/lib/work/stages";
import type { NoReplyRow as NoReplyData, WaitItem } from "@/lib/work/waiting";
import { LanePill, Line1, Line2, Name, Pill, RowButton, RowShell, waitTone } from "@/components/app/work/ui";

/**
 * One row of "Waiting on someone" (the two day groups): the deal or person, what is waited on and who, since when and
 * the stage or role, the days pill (amber at the threshold, red at double), and Follow up, which opens the email editor
 * with a drafted follow-up (the editor is held by the Home board, so it stays open while the row moves to another
 * group after the send). Sending logs the email on the deal or person (the existing send path) and starts the wait
 * again from today ("Followed up"). A person row carries the Contacts area pill (deal rows have none, as on Next
 * actions). Push E: when a reply arrived in the thread of the email the wait came from (Add to Waiting), the row shows
 * the green "Replied Nov 6" and Clear (which empties Waiting on) in place of Follow up; it does not clear by itself,
 * because the reply may not settle it. A click on the row outside the buttons and the name opens the deal or person.
 */
export function WaitingRow({ item, followedUp, onFollowUp, onClear, clearing }: { item: WaitItem; followedUp: boolean; onFollowUp: () => void; onClear: () => void; clearing: boolean }) {
  return (
    <RowShell
      testId="waiting-row"
      dataAttrs={{ [item.kind === "deal" ? "data-deal" : "data-person"]: item.id, "data-kind": item.kind, "data-replied": item.repliedOn ? "1" : "0" }}
      open={item.href}
      openLabel={`Open ${item.name}`}
      stack
      right={
        <>
          <span className="text-xs text-muted-foreground" data-testid="waiting-since">
            {[item.since ? `Since ${fmtDate(item.since, "MMM d")}` : null, item.context].filter(Boolean).join(" · ")}
          </span>
          {item.repliedOn ? (
            <span className="ml-auto flex items-center gap-2">
              <Pill tone="green" testId="waiting-replied">
                Replied {fmtDate(item.repliedOn, "MMM d")}
              </Pill>
              <RowButton tone="cobalt" onClick={onClear} disabled={clearing} data-testid="waiting-clear">
                {clearing ? "Clearing..." : "Clear"}
              </RowButton>
            </span>
          ) : followedUp ? (
            <Pill tone="green" testId="follow-up-sent">
              Followed up. The wait starts again today.
            </Pill>
          ) : (
            <RowButton tone="soft" onClick={onFollowUp} className="ml-auto" data-testid="follow-up-button">
              Follow up
            </RowButton>
          )}
        </>
      }
    >
      <Line1>
        {item.kind === "person" ? <LanePill lane="People" /> : null}
        <Link href={item.href} className="hover:underline">
          <Name>{item.name}</Name>
        </Link>
        <Pill tone={waitTone(item.level)} className="tabular" testId="waiting-days">
          {daysLabel(item.days)}
        </Pill>
      </Line1>
      <Line2>
        {item.waitingOn}
        {item.who ? ` · ${item.who}` : ""}
      </Line2>
    </RowShell>
  );
}

/**
 * One row of "No reply yet" (push E): "Sent Nov 2 to Mark Reed: <subject>", the deal or other record it is about under
 * it, then Add to Waiting and Dismiss. A click elsewhere on the row opens the deal or the person.
 */
export function NoReplyRow({ row, busy, onAdd, onDismiss }: { row: NoReplyData; busy: boolean; onAdd: () => void; onDismiss: () => void }) {
  return (
    <RowShell
      testId="no-reply-row"
      dataAttrs={{ "data-comm": row.commId, "data-target": row.target }}
      open={row.href}
      openLabel={`Open ${row.target === "deal" ? (row.recordName ?? "the deal") : (row.to ?? "the person")}`}
      stack
      right={
        <span className="ml-auto flex items-center gap-2">
          <RowButton tone="soft" onClick={onAdd} disabled={busy} data-testid="no-reply-add">
            Add to Waiting
          </RowButton>
          <RowButton onClick={onDismiss} disabled={busy} data-testid="no-reply-dismiss">
            Dismiss
          </RowButton>
        </span>
      }
    >
      <Line1>
        <span className="min-w-0 text-[13.5px] text-slate-900" data-testid="no-reply-line">
          <b className="font-semibold">
            Sent {fmtDate(row.sentOn, "MMM d")}
            {row.to ? ` to ${row.to}` : ""}:
          </b>{" "}
          {row.subject}
        </span>
      </Line1>
      {row.recordName ? <Line2 className="text-muted-foreground">{row.recordName}</Line2> : null}
    </RowShell>
  );
}
