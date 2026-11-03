"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { lastContactLabel, matchesOutreachFilter, matchesPersonSearch, OUTREACH_FILTERS, OUTREACH_SECTIONS, outreachFilterCounts, outreachSections, type OutreachFilter } from "@/lib/work/outreach";
import type { OutreachData, PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import type { OrganizationsData, OrgRow } from "@/lib/work/organizations-data";
import { byName, matchesOrgFilter, matchesOrgSearch, matchesRole, onFollowUps, orgFilters, organizationHref, orgLine, PEOPLE_HREF, PEOPLE_VIEWS, peopleNamesLine, peopleViewHref, personHref, roleCounts, roleFilters, type OrgFilter, type PeopleView, type RoleFilter } from "@/lib/work/people";
import { AddOrganizationCard } from "@/components/app/work/add-organization";
import { AddPersonCard } from "@/components/app/work/add-person";
import { LogCallDrawer, type LogCallTarget } from "@/components/app/work/log-call-drawer";
import { PersonRow } from "@/components/app/work/person-row";
import { useSections } from "@/components/app/work/sections";
import { Figure, Figures, FilterRow, Line1, Line2, Name, PinnedBlock, Quiet, ROW_COLS, RowButton, RowButtons, RowShell, SectionHeading, TargetBar, What, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * People (push B, 2026-11-03; Outreach renamed, approved mockup 2026-11-02): the pinned block with the title, the add
 * button, the Work tabs, and one filter row: the view choice (Follow-ups, Everyone, Organizations, each with its count),
 * a hairline, the view's own pills, Find, and (Follow-ups) Collapse all.
 *  - Follow-ups: what Outreach was. The weekly counter and the sections by next follow-up; Email, Log a call, Done.
 *  - Everyone: every person A to Z in one card, with the role filter; Email and Log a call.
 *  - Organizations: every firm A to Z with its kind and region, the people there, open deals, last contact; Email.
 * Archived people and organizations sit in a slim bar at the bottom of their view.
 */
const STORAGE_KEY = "work-outreach-sections";
const CARD = "rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export function PeopleBoard({ header, view, data, orgs, adding, saved, role: roleAtStart }: { header: React.ReactNode; view: PeopleView; data: OutreachData; orgs: OrganizationsData; adding: boolean; saved?: string | null; role?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<OutreachFilter>("all");
  const roles = useMemo(() => roleFilters(data.people), [data.people]);
  const [role, setRole] = useState<RoleFilter>((roles.find((r) => r.key === roleAtStart)?.key ?? "all") as RoleFilter);
  const kinds = useMemo(() => orgFilters(orgs.orgs), [orgs.orgs]);
  const [kind, setKind] = useState<OrgFilter>("all");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState<{ key: string; setup: ComposeSetup } | null>(null);
  const [call, setCall] = useState<LogCallTarget | null>(null);
  const [callKey, setCallKey] = useState<string | null>(null);
  /** What was logged on a row on this visit ("Call logged, 20 min"), kept until the page re-reads. */
  const [logged, setLogged] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const { today } = data;

  const follow = useMemo(() => data.people.filter(onFollowUps), [data.people]);
  const sections = useMemo(() => outreachSections(follow, today), [follow, today]);
  const counts = useMemo(() => outreachFilterCounts(follow, today), [follow, today]);
  const everyone = useMemo(() => byName(data.people), [data.people]);
  const rCounts = useMemo(() => roleCounts(data.people, roles), [data.people, roles]);
  const kCounts = useMemo(() => Object.fromEntries(kinds.map((k) => [k.key, orgs.orgs.filter((o) => matchesOrgFilter(o, k.key)).length])) as Record<OrgFilter, number>, [kinds, orgs.orgs]);
  const shown = (p: PersonRowData) => matchesOutreachFilter(p, filter, today) && matchesPersonSearch(p, query);
  const states = useMemo(() => OUTREACH_SECTIONS.map((s) => ({ name: s.label, count: sections[s.key].length, hasMatch: sections[s.key].some((p) => matchesOutreachFilter(p, filter, today)) })), [sections, filter, today]);
  const ui = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: OutreachFilter) => {
    setFilter(f);
    ui.resetOverrides();
  };
  const viewCount: Record<PeopleView, number> = { follow: counts.today + counts.over, everyone: data.people.length, orgs: orgs.orgs.length };
  const onEmailPerson = (p: PersonRowData) => data.composes[p.id] && setEmail({ key: p.id, setup: data.composes[p.id] });
  const onCallPerson = (p: PersonRowData) => {
    setCallKey(p.id);
    setCall({ contactId: p.id, dealId: null, who: p.name, from: view === "follow" ? "From People, Follow-ups" : "From People, Everyone", currentDate: p.nextFollowUp });
  };
  const closeHref = peopleViewHref(view);

  const viewChoice = (
    <span className="inline-flex overflow-hidden rounded-full border border-border bg-white" role="group" aria-label="View" data-testid="people-view">
      {PEOPLE_VIEWS.map((v, i) => (
        <Link key={v.key} href={peopleViewHref(v.key)} aria-current={view === v.key ? "page" : undefined} className={cn("inline-flex items-center px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", view === v.key ? "bg-primary-soft text-primary-strong" : "text-slate-600 hover:bg-slate-50")} data-testid={`people-view-${v.key}`}>
          {v.label}
          <span className={cn("tabular ml-[5px]", view === v.key ? "text-primary-strong" : "text-slate-400")}>{viewCount[v.key]}</span>
        </Link>
      ))}
    </span>
  );
  const sep = <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />;

  return (
    <>
      <PinnedBlock testId="people-sticky">
        {header}
        <div className="-mt-2 flex flex-wrap items-center gap-2" data-testid="people-filter-row">
          {viewChoice}
          {sep}
          {view === "follow" ? (
            <FilterRow prefix="outreach" filters={OUTREACH_FILTERS.map((f) => ({ key: f.key, label: f.label, sepBefore: f.key === "off_market_deals" }))} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find a person" collapse={{ allCollapsed: ui.allCollapsed, onClick: ui.toggleAll }} className="contents" searchClassName="sm:w-[150px]" />
          ) : view === "everyone" ? (
            <FilterRow prefix="everyone" filters={roles} active={role} counts={rCounts as Record<RoleFilter, number>} onPick={setRole} query={query} onQuery={setQuery} placeholder="Find a person" className="contents" searchClassName="sm:w-[150px]" />
          ) : (
            <FilterRow prefix="orgs" filters={kinds} active={kind} counts={kCounts} onPick={setKind} query={query} onQuery={setQuery} placeholder="Find an organization" className="contents" searchClassName="sm:w-[170px]" />
          )}
        </div>
      </PinnedBlock>
      <div className="flex flex-col gap-[18px]">
        {saved ? (
          <p className="rounded-md bg-status-met-bg px-3 py-2 text-[13px] text-status-met" role="status" data-testid="person-saved">
            Saved {saved}.{" "}
            <Link href={closeHref} className="underline">
              Clear
            </Link>
          </p>
        ) : null}
        {adding ? view === "orgs" ? <AddOrganizationCard onClose={() => router.push(closeHref)} /> : <AddPersonCard onClose={() => router.push(closeHref)} /> : null}

        {view === "follow" ? (
          <section className={CARD} data-testid="outreach-card">
            <TargetBar count={data.counter.count} target={data.counter.target} pct={data.counter.pct} hint="Counted from emails sent and calls logged, Mon to Fri" />
            <div className="mx-[22px] h-px bg-rule" />
            {follow.length ? (
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
                              <PersonRow person={p} today={today} onEmail={onEmailPerson} onCall={onCallPerson} done={logged[p.id]} />
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
        ) : null}

        {view === "everyone" ? (
          <WorkCard title="Everyone" count={everyone.filter((p) => matchesRole(p, role) && matchesPersonSearch(p, query)).length || null} hint="A to Z" testId="everyone-card">
            <div className="flex flex-col pb-1" data-testid="everyone-rows">
              {everyone.filter((p) => matchesRole(p, role) && matchesPersonSearch(p, query)).map((p) => (
                <div key={p.id} className="border-t border-slate-100 first:border-t-0" data-testid="everyone-row" data-role={p.roleKey ?? ""}>
                  <PersonRow person={p} today={today} onEmail={onEmailPerson} onCall={onCallPerson} done={logged[p.id]} showDone={false} />
                </div>
              ))}
              {!everyone.some((p) => matchesRole(p, role) && matchesPersonSearch(p, query)) ? <Quiet testId="everyone-empty">{query.trim() ? "No one matches." : "No one with this role yet."}</Quiet> : null}
            </div>
          </WorkCard>
        ) : null}

        {view === "orgs" ? (
          <WorkCard title="Organizations" count={orgs.orgs.filter((o) => matchesOrgFilter(o, kind) && matchesOrgSearch(o, query)).length || null} hint="A to Z" testId="orgs-card">
            <div className="flex flex-col pb-1" data-testid="org-rows">
              {orgs.orgs.filter((o) => matchesOrgFilter(o, kind) && matchesOrgSearch(o, query)).map((o) => (
                <OrgListRow key={o.id} org={o} today={today} canEmail={!!orgs.composes[o.id]} onEmail={() => setEmail({ key: o.id, setup: orgs.composes[o.id] })} done={logged[o.id]} />
              ))}
              {!orgs.orgs.some((o) => matchesOrgFilter(o, kind) && matchesOrgSearch(o, query)) ? <Quiet testId="orgs-empty">{orgs.orgs.length ? "No organization matches." : "No organizations yet. Add one, or type a firm on a person's Facts."}</Quiet> : null}
            </div>
          </WorkCard>
        ) : null}

        {view !== "orgs" && data.archived.length ? (
          <ArchivedBar count={data.archived.length} open={showArchived} onToggle={() => setShowArchived((o) => !o)} hint="Reopen a person on their page to bring them back" testId="outreach-archived">
            {data.archived.map((p) => (
              <Link key={p.id} href={personHref(p.id)} className="row-hover flex flex-wrap items-center gap-x-2.5 border-t border-slate-100 px-[22px] py-2.5 text-sm first:border-t-0" data-testid="archived-row">
                <span className="font-semibold text-slate-900">{p.name}</span>
                <span className="text-[13px] text-muted-foreground">{[p.organization, p.roleLabel].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </ArchivedBar>
        ) : null}
        {view === "orgs" && orgs.archived.length ? (
          <ArchivedBar count={orgs.archived.length} open={showArchived} onToggle={() => setShowArchived((o) => !o)} hint="Reopen an organization on its page to bring it back" testId="orgs-archived">
            {orgs.archived.map((o) => (
              <Link key={o.id} href={organizationHref(o.id)} className="row-hover flex flex-wrap items-center gap-x-2.5 border-t border-slate-100 px-[22px] py-2.5 text-sm first:border-t-0" data-testid="archived-row">
                <span className="font-semibold text-slate-900">{o.name}</span>
                <span className="text-[13px] text-muted-foreground">{orgLine(o)}</span>
              </Link>
            ))}
          </ArchivedBar>
        ) : null}
      </div>
      {email ? (
        <ComposeEmailDialog
          key={email.key}
          setup={email.setup}
          open
          onOpenChange={(o) => {
            if (!o) setEmail(null);
          }}
          onSent={() => {
            setLogged((m) => ({ ...m, [email.key]: "Email sent and logged" }));
            router.refresh();
          }}
        />
      ) : null}
      {call && callKey ? (
        <LogCallDrawer
          target={call}
          today={today}
          tz={data.tz}
          open
          onOpenChange={(o) => {
            if (!o) setCall(null);
          }}
          onSaved={(r) => {
            setLogged((m) => ({ ...m, [callKey]: `Call logged, ${r.minutes} min` }));
            setTimeout(() => router.refresh(), 1200);
          }}
        />
      ) : null}
    </>
  );
}

function ArchivedBar({ count, open, onToggle, hint, children, testId }: { count: number; open: boolean; onToggle: () => void; hint: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2.5 text-[13px] text-muted-foreground">
        <span className="tabular">Archived {count}</span>
        <button type="button" onClick={onToggle} className="font-medium text-primary-strong hover:underline" data-testid="archived-toggle">
          {open ? "Hide" : "Show"}
        </button>
        <span className="min-w-0 text-xs text-slate-400 sm:ml-auto sm:text-right">{hint}</span>
      </div>
      {open ? <div className="flex flex-col border-t border-slate-100">{children}</div> : null}
    </div>
  );
}

/**
 * One organization: the name with its kind and region, the people there on the second line; at the right PEOPLE,
 * OPEN DEALS, LAST CONTACT in fixed columns, and Email. The row opens the organization page.
 */
function OrgListRow({ org, today, canEmail, onEmail, done }: { org: OrgRow; today: string; canEmail: boolean; onEmail: () => void; done?: string }) {
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <RowShell
        testId="org-row"
        textGap
        dataAttrs={{ "data-org": org.id, "data-kind": org.kind }}
        open={organizationHref(org.id)}
        openLabel={`Open ${org.name}`}
        right={
          <>
            <Figures className="mr-1" testId="org-figures">
              <Figure value={String(org.peopleCount)} label="People" col="people" testId="org-people" />
              <Figure value={org.openDeals ? String(org.openDeals) : "None"} label="Open deals" col="openDeals" testId="org-open-deals" />
              <Figure value={lastContactLabel(org.lastContactOn, org.lastContactKind, today, (d) => fmtDate(d, "MMM d"))} label="Last contact" col="lastContact" testId="org-last-contact" />
            </Figures>
            <RowButtons>
              <RowButton onClick={onEmail} disabled={!canEmail} className={ROW_COLS.button.cls} data-testid="org-email">
                <Mail className="mr-1 h-3.5 w-3.5" /> Email
              </RowButton>
            </RowButtons>
          </>
        }
      >
        <Line1>
          <Link href={organizationHref(org.id)} className="hover:underline" data-testid="org-link">
            <Name>{org.name}</Name>
          </Link>
          <What>{orgLine(org)}</What>
        </Line1>
        <Line2 className="text-slate-600">{peopleNamesLine(org.peopleNames)}</Line2>
        {done ? <span className="mt-1.5 inline-block text-[12.5px] font-medium text-status-met">{done}</span> : null}
      </RowShell>
    </div>
  );
}

export { PEOPLE_HREF };
