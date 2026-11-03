"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { savePartnerReports } from "@/app/actions/accountability";
import { REPORT_SECTIONS, REPORT_WEEKDAYS, daysLabel } from "@/lib/accountability/partners";
import { date as fmtDate } from "@/lib/format";
import type { PartnerInfo } from "@/lib/work/outreach-data";
import { WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Reports card (push B, approved mockup 2026-11-02): on an accountability partner's page it takes the place of
 * "Why in touch". The weekdays they get the End of day report (Mon to Fri chips) and the sections they get (a
 * checklist of the report's sections). Each click saves at once; End of day sends each partner due that day only their
 * own sections. The foot line counts the reports sent and the replies, and links to them on Reports.
 */
export function PartnerReportsCard({ personId, email, info, replyNote }: { personId: string; email: string | null; info: PartnerInfo; /** "Reconnect Google to see replies" when the read permission is missing. */ replyNote: string | null }) {
  const router = useRouter();
  const [days, setDays] = useState<number[]>(info.days);
  const [sections, setSections] = useState<string[]>(info.sections);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saved" } | { kind: "error"; text: string }>({ kind: "idle" });
  const [pending, start] = useTransition();
  const save = (nextDays: number[], nextSections: string[]) => {
    const before = { days, sections };
    setDays(nextDays);
    setSections(nextSections);
    start(async () => {
      const r = await savePartnerReports(personId, { days: nextDays, sections: nextSections });
      if (!r.ok) {
        setDays(before.days);
        setSections(before.sections);
        return setState({ kind: "error", text: r.error });
      }
      setState({ kind: "saved" });
      router.refresh();
    });
  };
  const toggleDay = (n: number) => save(days.includes(n) ? days.filter((d) => d !== n) : [...days, n].sort(), sections);
  const toggleSection = (k: string) => save(days, sections.includes(k) ? sections.filter((s) => s !== k) : REPORT_SECTIONS.map((s) => s.key).filter((x) => x === k || sections.includes(x)));
  return (
    <WorkCard title="Reports" sub={email ? `Sent from End of day to ${email}` : "No email address yet: add it in Facts so the report can go out"} testId="partner-reports-card">
      <div className="flex flex-col px-[22px] pt-3 pb-4">
        <span className="label-caps mb-2" id="partner-days-label">
          Gets the report on
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="partner-days-label" data-testid="partner-days">
          {REPORT_WEEKDAYS.map((d) => {
            const on = days.includes(d.n);
            return (
              <button key={d.n} type="button" onClick={() => toggleDay(d.n)} disabled={pending} aria-pressed={on} className={cn("h-8 w-[52px] rounded-[7px] border text-[13px] font-medium", on ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-500 hover:bg-slate-50")} data-testid="partner-day" data-day={d.n} data-on={on ? "1" : "0"}>
                {d.label}
              </button>
            );
          })}
        </div>
        <span className="mt-1.5 text-[12.5px] text-muted-foreground" data-testid="partner-days-line">
          {days.length ? `Gets it ${daysLabel(days)} at 5:30 pm.` : "Gets no report until a day is chosen."}
        </span>
        <span className="label-caps mt-5 mb-1" id="partner-sections-label">
          Sections
        </span>
        <div className="flex flex-col" role="group" aria-labelledby="partner-sections-label" data-testid="partner-sections">
          {REPORT_SECTIONS.map((s) => {
            const on = sections.includes(s.key);
            return (
              <label key={s.key} className="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-start gap-x-3 border-b border-slate-100 py-2 last:border-b-0" data-testid="partner-section" data-section={s.key} data-on={on ? "1" : "0"}>
                <input type="checkbox" checked={on} onChange={() => toggleSection(s.key)} disabled={pending} className="mt-[3px] h-4 w-4 accent-[var(--primary)]" data-testid={`partner-section-${s.key}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-900">{s.label}</span>
                  {s.hint ? <span className="block text-[12.5px] text-muted-foreground">{s.hint}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-rule pt-3 text-[12.5px] text-muted-foreground" data-testid="partner-report-stats">
          <span className="tabular">{info.sent} sent</span>
          <span aria-hidden>·</span>
          <span className="tabular">
            {info.replies} {info.replies === 1 ? "reply" : "replies"}
          </span>
          {info.lastSentOn ? (
            <>
              <span aria-hidden>·</span>
              <span>last sent {fmtDate(info.lastSentOn, "EEE MMM d")}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <Link href={`/work/reports?view=sent&partner=${personId}`} className="font-medium text-primary-strong hover:underline" data-testid="partner-see-reports">
            See the reports
          </Link>
          {state.kind === "saved" ? (
            <span className="ml-auto font-medium text-status-met" role="status" data-testid="partner-saved">
              Saved
            </span>
          ) : state.kind === "error" ? (
            <span className="ml-auto text-status-missed" role="alert" data-testid="partner-error">
              {state.text}
            </span>
          ) : null}
        </div>
        {replyNote ? (
          <p className="mt-2 text-[12.5px] text-status-soon" data-testid="replies-reconnect">
            {replyNote}{" "}
            <Link href="/settings" className="font-medium underline">
              Open Settings
            </Link>
          </p>
        ) : null}
      </div>
    </WorkCard>
  );
}
