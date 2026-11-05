"use client";

import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { daysLabel } from "@/lib/work/stages";
import type { NoReplyRow as NoReplyData, WaitItem, WaitItemLine } from "@/lib/work/waiting";
import { LanePill, Line1, Line2, Name, Pill, RowButton, RowShell, waitTone } from "@/components/app/work/ui";

/**
 * One row of "Waiting on someone" (the two day groups; push E2): the deal or person and, quiet after the name, the
 * stage or role; then each wait on its own line, longest first: what is waited on and who, its own days pill (amber at
 * the threshold, red at double), Since, and its own Follow up, which opens the email editor with a drafted follow-up
 * (the editor is held by the Home board, so it stays open while the row moves to another group after the send).
 * Sending logs the email on the deal or person and starts that wait again from today ("Followed up"). When a reply
 * arrived in the thread of the email a wait came from (Add to Waiting) or of its follow-up, that line shows the green
 * "Replied Nov 6" and Clear (which removes that wait) in place of Follow up; it does not clear by itself, because the
 * reply may not settle it. A person row carries the Contacts area pill (deal rows have none, as on Next actions). The
 * days pills sit in one fixed column and the buttons at the right edge, so the lines line up when their text wraps. A
 * click on the row outside the buttons and the name opens the deal or person.
 */
export function WaitingRow({ item, followedUp, onFollowUp, onClear, clearing }: { item: WaitItem; /** Wait ids followed up on this visit. */ followedUp: Record<string, boolean>; onFollowUp: (line: WaitItemLine) => void; onClear: (line: WaitItemLine) => void; /** The wait id being cleared. */ clearing: string | null }) {
  return (
    <RowShell
      testId="waiting-row"
      dataAttrs={{ [item.kind === "deal" ? "data-deal" : "data-person"]: item.id, "data-kind": item.kind, "data-lines": String(item.lines.length), "data-replied": item.lines.some((l) => l.repliedOn) ? "1" : "0" }}
      open={item.href}
      openLabel={`Open ${item.name}`}
      stack
    >
      {/* Edits of Nov 5: every part of the heading sits in a 20px line box, top-aligned and on one row, so the stage or
          role is centered on the name's line instead of riding higher; a long name wraps beside it, and the stage stays
          level with the name's first line. */}
      <Line1 className="flex-nowrap items-start">
        {item.kind === "person" ? (
          <span className="flex h-5 shrink-0 items-center">
            <LanePill lane="People" />
          </span>
        ) : null}
        <Link href={item.href} className="block min-w-0 text-sm leading-5 hover:underline" data-testid="waiting-name">
          <Name className="leading-5">{item.name}</Name>
        </Link>
        {item.context ? (
          <span className="block shrink-0 text-xs leading-5 whitespace-nowrap text-muted-foreground" data-testid="waiting-context">
            {item.context}
          </span>
        ) : null}
      </Line1>
      <div className="mt-2 flex flex-col gap-2.5" data-testid="waiting-lines">
        {item.lines.map((l) => (
          <WaitLineRow key={l.waitId} line={l} followedUp={!!followedUp[l.waitId]} onFollowUp={() => onFollowUp(l)} onClear={() => onClear(l)} clearing={clearing === l.waitId} />
        ))}
      </div>
    </RowShell>
  );
}

/** One wait inside a waiting row: the text and who with the days pill in its fixed column, then Since and the action. */
function WaitLineRow({ line, followedUp, onFollowUp, onClear, clearing }: { line: WaitItemLine; followedUp: boolean; onFollowUp: () => void; onClear: () => void; clearing: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_64px] items-start gap-x-3 gap-y-1.5 border-l-2 border-slate-200 pl-3" data-testid="waiting-line" data-wait={line.waitId} data-replied={line.repliedOn ? "1" : "0"}>
      <div className="min-w-0 text-[13px] leading-5 text-slate-700" data-testid="waiting-what">
        {line.waitingOn}
        {line.who ? <span className="text-muted-foreground">{` · ${line.who}`}</span> : null}
      </div>
      <div className="flex justify-end" data-col="days">
        <Pill tone={waitTone(line.level)} className="tabular" testId="waiting-days">
          {daysLabel(line.days)}
        </Pill>
      </div>
      <div className="col-span-2 flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs text-muted-foreground" data-testid="waiting-since">
          {line.since ? `Since ${fmtDate(line.since, "MMM d")}` : null}
        </span>
        {line.repliedOn ? (
          <span className="ml-auto flex items-center gap-2">
            <Pill tone="green" testId="waiting-replied">
              Replied {fmtDate(line.repliedOn, "MMM d")}
            </Pill>
            <RowButton tone="cobalt" onClick={onClear} disabled={clearing} data-testid="waiting-clear">
              {clearing ? "Clearing..." : "Clear"}
            </RowButton>
          </span>
        ) : followedUp ? (
          <Pill tone="green" className="ml-auto" testId="follow-up-sent">
            Followed up. The wait starts again today.
          </Pill>
        ) : (
          <RowButton tone="soft" onClick={onFollowUp} className="ml-auto" data-testid="follow-up-button">
            Follow up
          </RowButton>
        )}
      </div>
    </div>
  );
}

/**
 * One row of "No reply yet" (push E; wording of Nov 5): "Emailed Nov 2 to Mark Reed: <subject>", the deal or other record it is about under
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
            Emailed {fmtDate(row.sentOn, "MMM d")}
            {row.to ? ` to ${row.to}` : ""}:
          </b>{" "}
          {row.subject}
        </span>
      </Line1>
      {row.recordName ? <Line2 className="text-muted-foreground">{row.recordName}</Line2> : null}
    </RowShell>
  );
}
