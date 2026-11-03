"use client";

import Link from "next/link";
import { ShowAll } from "@/components/app/work/show-all";
import type { TimelineEvent } from "@/lib/work/timeline";
import { Pill } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

const ICON: Record<TimelineEvent["kind"], { text: string; cls: string }> = {
  note: { text: "N", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  finding: { text: "F", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  email: { text: "E", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  call: { text: "C", cls: "border-status-met-border bg-status-met-bg text-status-met" },
  move: { text: "→", cls: "border-primary-border bg-primary-soft text-primary-strong" },
  report: { text: "R", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  reply: { text: "Re", cls: "border-primary-border bg-primary-soft text-primary-strong" },
  other: { text: "·", cls: "border-border bg-status-neutral-bg text-status-neutral" },
};

/** "harborhealthpartners.com" for a source link. */
function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * The timeline list (notes, findings, emails, calls, stage moves; newest first) shared by every record page. A
 * finding (batch B2) shows a neutral Finding pill before its line and "Source: <site>" under it, opening the link.
 * The long-list rule (push B edits): the newest 8, then "Show all (N)" opens every entry in a large window.
 */
export function TimelineEvents({ events, empty, windowTitle = "Timeline", windowSub }: { events: TimelineEvent[]; empty: string; windowTitle?: React.ReactNode; windowSub?: React.ReactNode }) {
  if (!events.length)
    return (
      <div className="px-[22px] pt-1 pb-1" data-testid="timeline-events">
        <p className="py-2 text-[13px] text-muted-foreground">{empty}</p>
      </div>
    );
  return (
    <ShowAll
      items={events}
      title={windowTitle}
      sub={windowSub ?? `All ${events.length} entries, newest first`}
      text={(e) => `${e.date} ${e.title} ${e.detail ?? ""}`}
      testId="timeline-all"
      wrap={(rows, inWindow) => (
        <div className="px-[22px] pt-1 pb-1" data-testid={inWindow ? "timeline-events-all" : "timeline-events"}>
          {rows}
        </div>
      )}
      render={(e) => <TimelineEntry key={e.id} e={e} />}
    />
  );
}

function TimelineEntry({ e }: { e: TimelineEvent }) {
  return (
          <div className="grid grid-cols-[56px_22px_minmax(0,1fr)] gap-x-2.5 border-b border-slate-100 py-[9px] last:border-b-0" data-testid="timeline-event" data-kind={e.kind}>
            <span className="pt-0.5 text-xs text-muted-foreground">{e.date}</span>
            <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full border font-bold", e.kind === "reply" ? "text-[8.5px] tracking-[-0.02em]" : "text-[10px]", ICON[e.kind].cls)} aria-hidden>
              {ICON[e.kind].text}
            </span>
            <span className="min-w-0 text-sm text-slate-900">
              {e.kind === "finding" ? (
                <>
                  <Pill tone="gray" className="mr-1.5 align-[1px]" testId="finding-pill">
                    Finding
                  </Pill>
                  {e.title}
                  {e.detail ? <span className="block text-[12.5px] text-muted-foreground">{e.detail}</span> : null}
                  {e.href ? (
                    <a href={e.href.startsWith("http") ? e.href : `https://${e.href}`} target="_blank" rel="noreferrer" className="block text-[12.5px] text-primary-strong hover:underline" data-testid="finding-source">
                      Source: {hostOf(e.href)}
                    </a>
                  ) : null}
                </>
              ) : (
                <>
                  {e.href ? (
                    <Link href={e.href} className="hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}
                  {e.detail ? (e.quote ? <span className="mt-0.5 block text-[13px] text-slate-700 italic" data-testid="timeline-quote">&ldquo;{e.detail}&rdquo;</span> : <span className="block text-[12.5px] text-muted-foreground">{e.detail}</span>) : null}
                  {e.link ? (
                    <Link href={e.link.href} className="block text-[12.5px] text-primary-strong hover:underline" data-testid="timeline-link">
                      {e.link.label}
                    </Link>
                  ) : null}
                </>
              )}
            </span>
          </div>
  );
}
