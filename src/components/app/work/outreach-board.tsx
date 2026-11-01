"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { matchesOutreachFilter, matchesPersonSearch, OUTREACH_FILTERS, OUTREACH_SECTIONS, outreachFilterCounts, outreachSections, type OutreachFilter } from "@/lib/work/outreach";
import type { OutreachData, PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { AddPersonCard } from "@/components/app/work/add-person";
import { LogCallDrawer, type LogCallTarget } from "@/components/app/work/log-call-drawer";
import { PersonRow } from "@/components/app/work/person-row";
import { useSections } from "@/components/app/work/sections";
import { FilterRow, PinnedBlock, Quiet, SectionHeading, TargetBar } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Outreach (batch B, mockup v7 approved 2026-10-31): the pinned block with the title, Add a person, the Work tabs,
 * and the filter row (All, Due today, Overdue, No date, then the purpose pills Off-market deals, Job search,
 * Consulting, Rosara with counts, Find a person, Collapse all). Then the Add a person card (when open) and one card:
 * the weekly counter with its gold bar, and the sections by next follow-up: Overdue, Due today, Next 7 days, Later,
 * No date. The page scrolls as one. A filter shows only the matching rows, opens the sections with a match and
 * collapses the rest; the sections the person collapses are remembered in this browser. Archived people sit in a
 * slim bar at the bottom.
 */
const STORAGE_KEY = "work-outreach-sections";

export function OutreachBoard({ header, data, adding, saved }: { /** The title, Add a person, and the Work tabs (server-rendered). */ header: React.ReactNode; data: OutreachData; /** The Add a person card is open (?add=1). */ adding: boolean; /** The name just saved by Add a person (the "Saved" line). */ saved?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<OutreachFilter>("all");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState<PersonRowData | null>(null);
  const [call, setCall] = useState<PersonRowData | null>(null);
  /** What was logged on a row on this visit ("Call logged, 20 min"), kept until the page re-reads. */
  const [logged, setLogged] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const { people, today } = data;

  const sections = useMemo(() => outreachSections(people, today), [people, today]);
  const counts = useMemo(() => outreachFilterCounts(people, today), [people, today]);
  const shown = (p: PersonRowData) => matchesOutreachFilter(p, filter, today) && matchesPersonSearch(p, query);
  const states = useMemo(() => OUTREACH_SECTIONS.map((s) => ({ name: s.label, count: sections[s.key].length, hasMatch: sections[s.key].some((p) => matchesOutreachFilter(p, filter, today)) })), [sections, filter, today]);
  const ui = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: OutreachFilter) => {
    setFilter(f);
    ui.resetOverrides();
  };
  const callTarget: LogCallTarget | null = call ? { contactId: call.id, dealId: null, who: call.name, from: "From Outreach", currentDate: call.nextFollowUp } : null;

  return (
    <>
      <PinnedBlock testId="outreach-sticky">
        {header}
        <FilterRow prefix="outreach" filters={OUTREACH_FILTERS.map((f) => ({ key: f.key, label: f.label, gold: !!f.purpose, sepBefore: f.key === "off_market_deals" }))} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find a person" collapse={{ allCollapsed: ui.allCollapsed, onClick: ui.toggleAll }} className="-mt-2" searchClassName="sm:w-[150px]" />
      </PinnedBlock>
      <div className="flex flex-col gap-[18px]">
        {saved ? (
          <p className="rounded-md bg-status-met-bg px-3 py-2 text-[13px] text-status-met" role="status" data-testid="person-saved">
            Saved {saved}.{" "}
            <Link href="/work/outreach" className="underline">
              Clear
            </Link>
          </p>
        ) : null}
        {adding ? <AddPersonCard onClose={() => router.push("/work/outreach")} /> : null}
        <section className="rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="outreach-card">
          <TargetBar count={data.counter.count} target={data.counter.target} pct={data.counter.pct} hint="Counted from emails sent and calls logged, Mon to Fri" />
          <div className="mx-[22px] h-px bg-gold-rule" />
          {people.length ? (
            <div className="px-[22px] pt-1 pb-3">
              {OUTREACH_SECTIONS.map((s) => {
                const list = sections[s.key];
                const closed = ui.isCollapsed(s.label);
                return (
                  <div key={s.key} data-testid="outreach-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
                    <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => ui.toggle(s.label)} hint={s.hint} />
                    {list.length && !closed ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                        {list.map((p) => (
                          <div key={p.id} className={cn("border-t border-slate-100 first:border-t-0", !shown(p) && "hidden")} data-testid="outreach-row" data-hidden={shown(p) ? "0" : "1"}>
                            <PersonRow person={p} today={today} onEmail={setEmail} onCall={setCall} done={logged[p.id]} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <Quiet testId="outreach-empty">Nobody here yet. Add a person to start keeping in touch.</Quiet>
          )}
        </section>
        {data.archived.length ? (
          <div className="rounded-[10px] border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="outreach-archived">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2.5 text-[13px] text-muted-foreground">
              <span className="tabular">Archived {data.archived.length}</span>
              <button type="button" onClick={() => setShowArchived((o) => !o)} className="font-medium text-primary-strong hover:underline" data-testid="archived-toggle">
                {showArchived ? "Hide" : "Show"}
              </button>
              <span className="min-w-0 text-xs text-slate-400 sm:ml-auto sm:text-right">Reopen a person on their page to bring them back</span>
            </div>
            {showArchived ? (
              <div className="flex flex-col border-t border-slate-100">
                {data.archived.map((p) => (
                  <Link key={p.id} href={`/work/outreach/${p.id}`} className="flex flex-wrap items-center gap-x-2.5 border-t border-slate-100 px-[22px] py-2.5 text-sm first:border-t-0 hover:bg-[#fbfcfe]" data-testid="archived-row">
                    <span className="font-semibold text-slate-900">{p.name}</span>
                    <span className="text-[13px] text-muted-foreground">{[p.organization, p.roleLabel].filter(Boolean).join(" · ")}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {email && data.composes[email.id] ? (
        <ComposeEmailDialog
          key={email.id}
          setup={data.composes[email.id] as ComposeSetup}
          open
          onOpenChange={(o) => {
            if (!o) setEmail(null);
          }}
          onSent={() => {
            setLogged((m) => ({ ...m, [email.id]: "Email sent and logged" }));
            router.refresh();
          }}
        />
      ) : null}
      {callTarget && call ? (
        <LogCallDrawer
          target={callTarget}
          today={today}
          tz={data.tz}
          open
          onOpenChange={(o) => {
            if (!o) setCall(null);
          }}
          onSaved={(r) => {
            setLogged((m) => ({ ...m, [call.id]: `Call logged, ${r.minutes} min` }));
            setTimeout(() => router.refresh(), 1200);
          }}
        />
      ) : null}
    </>
  );
}
