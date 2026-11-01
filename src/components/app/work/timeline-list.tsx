import Link from "next/link";
import type { TimelineEvent } from "@/lib/work/timeline";
import { Pill } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

const ICON: Record<TimelineEvent["kind"], { text: string; cls: string }> = {
  note: { text: "N", cls: "border-border bg-status-neutral-bg text-status-neutral" },
  finding: { text: "F", cls: "border-gold-border bg-gold-soft text-gold-strong" },
  email: { text: "E", cls: "border-gold-border bg-gold-soft text-gold-strong" },
  call: { text: "C", cls: "border-status-met-border bg-status-met-bg text-status-met" },
  move: { text: "→", cls: "border-primary-border bg-primary-soft text-primary-strong" },
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
 * finding (batch B2) shows a gold Finding pill before its line and "Source: <site>" under it, opening the link.
 */
export function TimelineEvents({ events, empty }: { events: TimelineEvent[]; empty: string }) {
  return (
    <div className="px-[22px] pt-1 pb-1" data-testid="timeline-events">
      {events.length ? (
        events.map((e) => (
          <div key={e.id} className="grid grid-cols-[56px_22px_minmax(0,1fr)] gap-x-2.5 border-b border-slate-100 py-[9px] last:border-b-0" data-testid="timeline-event" data-kind={e.kind}>
            <span className="pt-0.5 text-xs text-muted-foreground">{e.date}</span>
            <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-bold", ICON[e.kind].cls)} aria-hidden>
              {ICON[e.kind].text}
            </span>
            <span className="min-w-0 text-sm text-slate-900">
              {e.kind === "finding" ? (
                <>
                  <Pill tone="gold" className="mr-1.5 align-[1px]" testId="finding-pill">
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
                  {e.detail ? <span className="block text-[12.5px] text-muted-foreground">{e.detail}</span> : null}
                </>
              )}
            </span>
          </div>
        ))
      ) : (
        <p className="py-2 text-[13px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
