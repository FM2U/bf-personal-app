"use client";

import { CONFIRM_SHORT_MS } from "@/lib/confirm-timing";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { FilterMenuButton, FilterPopover } from "@/components/app/filter-popover";
import { FilterChips, FilterWindow, type FilterView } from "@/components/app/filter-window";
import { StickySections } from "@/components/app/work/sticky-sections";
import type { ComposeSetup } from "@/lib/compose-email";
import { activeChips, applyFilters, clearGroup, filterButtonLabel, filterSummary, optionCounts, showLabel, tickedCount, ticksToParam, toggleTick, type FilterGroup, type Ticks } from "@/lib/filters";
import { date as fmtDate } from "@/lib/format";
import { lastContactLabel, matchesPersonSearch, OUTREACH_SECTIONS, outreachSections, type OutreachSectionKey } from "@/lib/work/outreach";
import type { OutreachData, PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import type { OrganizationsData, OrgRow } from "@/lib/work/organizations-data";
import { byName, followUpFilterGroups, matchesOrgSearch, onFollowUps, orgFilterGroups, organizationHref, orgLine, PEOPLE_HREF, PEOPLE_VIEWS, peopleNamesLine, peopleViewHref, personFilterGroups, personHref, type PeopleView } from "@/lib/work/people";
import { selectedTile, tileAfterFilter, type Tile } from "@/lib/work/tiles";
import { AddOrganizationCard } from "@/components/app/work/add-organization";
import { AddPersonCard } from "@/components/app/work/add-person";
import { LogCallDrawer, type LogCallTarget } from "@/components/app/work/log-call-drawer";
import { PersonRow } from "@/components/app/work/person-row";
import { SlimBar, SlimTools } from "@/components/app/work/slim-bar";
import { StatusTiles, TileChips } from "@/components/app/work/status-tiles";
import { FilterButton, FindBox, TitleRow, ViewSelector } from "@/components/app/work/title-row";
import { Figure, Figures, Line1, Line2, ListBand, Name, Pill, Quiet, ROW_COLS, RowButton, RowButtons, RowShell, TargetBar, What, WorkCard } from "@/components/app/work/ui";

/**
 * Contacts (push B, 2026-11-03; Outreach renamed People, then Contacts in the Push B edits; the header of 2026-11-04):
 * the title row with Add a person (or Add an organization) and Ask AI; under it the view choice as the page's main
 * control (Follow-ups, People, Organizations, each with the number of rows it shows) with Find and the Filter button
 * at the right; the top menu row under 1024px. Follow-ups: the Filter button says what is on ("Filter: Broker, Rosara
 * +1") and opens a small box under it (Role, Project; a tick applies at once). People and Organizations: the large
 * Filter window and the ticked choices as chips. Each view keeps its own ticks (in the
 * address, so a reload keeps them); the Filter window has the groups of the view.
 *  - Follow-ups: five tiles that work like tabs (Overdue, Due today, Next 7 days, Later, No date;
 *    src/lib/work/tiles.ts), then one card: the weekly counter and the selected tile's list under its pinned band;
 *    Email, Log a call, Done. Its Filter has Role and Project only.
 *  - People: every person A to Z in one card; Email and Log a call.
 *  - Organizations: every organization A to Z with its kind and region, the people there, open deals, last contact;
 *    Email. Archived ones show when Status: Archived is ticked.
 * After about 40px of scroll the slim pinned bar slides in: the small title, the compact view choice, the tiles as
 * chips (Follow-ups), and Find and Filter as icon buttons. Archived people sit in a slim bar at the bottom of
 * Follow-ups and People.
 */
const CARD = "rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const FIND_ID = "contacts-find";
const PANEL_ID = "follow-panel";
const FOLLOW_EMPTY: Record<OutreachSectionKey, string> = { overdue: "Nobody is overdue.", today: "Nobody is due today.", week: "Nobody is due in the next 7 days.", later: "Nobody is due later.", nodate: "Everyone has a follow-up date." };

export type PeopleTicks = Record<PeopleView, Ticks>;

/** The address of the page with a view and every view's ticks (ff, fp, fo). */
function viewUrl(view: PeopleView, ticks: PeopleTicks): string {
  const q = new URLSearchParams();
  if (view !== "follow") q.set("view", view);
  const keys: Record<PeopleView, string> = { follow: "ff", people: "fp", orgs: "fo" };
  for (const v of Object.keys(keys) as PeopleView[]) {
    const t = ticksToParam(ticks[v]);
    if (t) q.set(keys[v], t);
  }
  const s = q.toString();
  return s ? `${PEOPLE_HREF}?${s}` : PEOPLE_HREF;
}

export function PeopleBoard({ view: viewAtStart, data, orgs, adding, saved, ticks: ticksAtStart, addButton, askAi, tabs }: { view: PeopleView; data: OutreachData; orgs: OrganizationsData; adding: boolean; saved?: string | null; ticks: PeopleTicks; /** Add a person or Add an organization (server-rendered, follows the view). */ addButton: React.ReactNode; askAi: React.ReactNode; /** The top menu row (under 1024px). */ tabs: React.ReactNode }) {
  const router = useRouter();
  const [view, setView] = useState<PeopleView>(viewAtStart);
  const [prevView, setPrevView] = useState(viewAtStart);
  if (prevView !== viewAtStart) {
    setPrevView(viewAtStart);
    setView(viewAtStart);
  }
  const [ticks, setTicks] = useState<PeopleTicks>(ticksAtStart);
  const [filterOpen, setFilterOpen] = useState(false);
  /** Follow-ups: the button the small Filter box hangs under, or null while it is closed. */
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const closeFilter = useCallback(() => setFilterAnchor(null), []);
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState<{ key: string; setup: ComposeSetup } | null>(null);
  const [call, setCall] = useState<LogCallTarget | null>(null);
  const [callKey, setCallKey] = useState<string | null>(null);
  /** What was logged on a row on this visit ("Call logged, 20 min"), kept until the page re-reads. */
  const [logged, setLogged] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const { today } = data;

  // The groups of each view, built from the rows (the kinds held, the regions).
  const allOrgs = useMemo(() => byName([...orgs.orgs, ...orgs.archived]), [orgs.orgs, orgs.archived]);
  const kindById = useMemo(() => new Map(allOrgs.map((o) => [o.id, o.kind as string])), [allOrgs]);
  const heldKinds = useMemo(() => [...new Set(allOrgs.map((o) => o.kind as string))], [allOrgs]);
  const pGroups = useMemo(() => personFilterGroups<PersonRowData>(today, (id) => kindById.get(id) ?? null, heldKinds), [today, kindById, heldKinds]);
  const fGroups = useMemo(() => followUpFilterGroups<PersonRowData>(), []);
  const oGroups = useMemo(() => orgFilterGroups<OrgRow>(allOrgs), [allOrgs]);

  const followBase = useMemo(() => data.people.filter(onFollowUps), [data.people]);
  const peopleBase = useMemo(() => byName(data.people), [data.people]);
  const searchPeople = (list: PersonRowData[]) => list.filter((p) => matchesPersonSearch(p, query));
  const searchOrgs = (list: OrgRow[]) => list.filter((o) => matchesOrgSearch(o, query));
  // Follow-ups: the ticks pick the people (and the tile numbers); Find narrows the list under the selected tile.
  const followTicked = useMemo(() => applyFilters(followBase, fGroups, ticks.follow), [followBase, fGroups, ticks.follow]);
  const followRows = useMemo(() => followTicked.filter((p) => matchesPersonSearch(p, query)), [followTicked, query]);
  const peopleRows = useMemo(() => applyFilters(peopleBase, pGroups, ticks.people).filter((p) => matchesPersonSearch(p, query)), [peopleBase, pGroups, ticks.people, query]);
  const orgRows = useMemo(() => applyFilters(allOrgs, oGroups, ticks.orgs).filter((o) => matchesOrgSearch(o, query)), [allOrgs, oGroups, ticks.orgs, query]);
  // The number on each view is the rows it shows (its ticks and the search); the menu badge keeps "due now".
  const views: FilterView<PeopleView>[] = PEOPLE_VIEWS.map((v) => ({ key: v.key, label: v.label, count: v.key === "follow" ? followRows.length : v.key === "people" ? peopleRows.length : orgRows.length }));

  // ---------- The Follow-ups tiles ----------
  const tileSections = useMemo(() => outreachSections(followTicked, today), [followTicked, today]);
  const tiles: Tile<OutreachSectionKey>[] = OUTREACH_SECTIONS.map((s) => ({ key: s.key, label: s.label, count: tileSections[s.key].length, red: s.key === "overdue" }));
  const [chosenTile, setChosenTile] = useState<OutreachSectionKey | null>(null);
  const selected = selectedTile(chosenTile, tiles) as OutreachSectionKey;
  const listed = tileSections[selected].filter((p) => matchesPersonSearch(p, query));

  const pickView = (v: PeopleView) => {
    if (v === view) return;
    setView(v);
    setFilterAnchor(null);
    router.replace(viewUrl(v, ticks), { scroll: false });
  };
  const setViewTicks = (v: PeopleView, t: Ticks) => {
    const next = { ...ticks, [v]: t };
    setTicks(next);
    router.replace(viewUrl(view, next), { scroll: false });
    // A Filter tick that drops the selected tile to 0 selects the first tile with items.
    if (v === "follow") {
      const s = outreachSections(applyFilters(followBase, fGroups, t), today);
      setChosenTile(tileAfterFilter(selected, OUTREACH_SECTIONS.map((x) => ({ key: x.key, count: s[x.key].length }))));
    }
  };
  const groupsOf = (v: PeopleView) => (v === "orgs" ? (oGroups as FilterGroup<unknown>[]) : v === "follow" ? (fGroups as FilterGroup<unknown>[]) : (pGroups as FilterGroup<unknown>[]));
  const rowsForCounts = (v: PeopleView): unknown[] => (v === "orgs" ? searchOrgs(allOrgs) : v === "people" ? searchPeople(peopleBase) : searchPeople(followBase));
  const g = groupsOf(view);
  const t = ticks[view];
  const counts = optionCounts(rowsForCounts(view), g, t);
  const shownCount = view === "orgs" ? orgRows.length : view === "people" ? peopleRows.length : followRows.length;
  const noun = view === "orgs" ? "organizations" : "people";
  const summary = filterSummary(g, t, noun, view === "orgs" ? "that are" : "who are");
  const show = view === "orgs" ? showLabel(shownCount, "organization", "organizations") : showLabel(shownCount, "person", "people");
  const ticked = tickedCount(g, t);
  // Follow-ups has two groups: the small Filter box under the button. People and Organizations: the large window.
  const small = view === "follow";
  const openFilter = (el: HTMLElement) => (small ? setFilterAnchor((a) => (a === el ? null : el)) : setFilterOpen(true));

  const onEmailPerson = (p: PersonRowData) => data.composes[p.id] && setEmail({ key: p.id, setup: data.composes[p.id] });
  const onCallPerson = (p: PersonRowData) => {
    setCallKey(p.id);
    setCall({ contactId: p.id, dealId: null, who: p.name, from: view === "follow" ? "From Contacts, Follow-ups" : "From Contacts, People", currentDate: p.nextFollowUp });
  };
  const closeHref = peopleViewHref(view);
  const noMatch = (who: string) => (
    <Quiet testId="filter-empty">
      <b className="block font-semibold text-heading">No {who} matches.</b>
      Change or clear the filters.
    </Quiet>
  );
  const pickTile = (k: OutreachSectionKey) => setChosenTile(k);
  const placeholder = view === "orgs" ? "Find an organization" : "Find a person";

  return (
    <>
      <SlimBar
        title="Contacts"
        seg={<ViewSelector views={views} active={view} onPick={pickView} compact testId="slim-view" />}
        chips={view === "follow" ? <TileChips tiles={tiles} selected={selected} onPick={pickTile} label="Follow-ups" idPrefix="follow-chip" panelId={PANEL_ID} /> : null}
        tools={<SlimTools findId={FIND_ID} filterCount={ticked} onFilter={openFilter} filterOpen={small ? !!filterAnchor : filterOpen} />}
      />
      {/* Without tiles (People, Organizations) the full header ends here: the slim bar shows once it is gone. */}
      <header className="pb-5" data-testid="people-header" data-header-end={view === "follow" ? undefined : ""}>
        <TitleRow title="Contacts" add={addButton} askAi={askAi} />
        <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2.5" data-testid="people-filter-row">
          <ViewSelector views={views} active={view} onPick={pickView} />
          <div className="ml-auto flex items-center gap-2.5 max-[700px]:ml-0 max-[700px]:basis-full">
            <FindBox id={FIND_ID} value={query} onChange={setQuery} placeholder={placeholder} testId="filter-search" />
            {small ? <FilterMenuButton label={filterButtonLabel("Filter", g, t)} ticked={ticked} open={!!filterAnchor} onOpen={openFilter} /> : <FilterButton ticked={ticked} onOpen={() => setFilterOpen(true)} />}
          </div>
        </div>
        {small ? null : <FilterChips chips={activeChips(g, t)} onRemove={(group, value) => setViewTicks(view, toggleTick(t, group, value))} onClear={() => setViewTicks(view, {})} />}
        {tabs}
      </header>
      <FilterPopover anchor={small ? filterAnchor : null} onClose={closeFilter} groups={g} ticks={t} counts={counts} onToggle={(group, value) => setViewTicks(view, toggleTick(t, group, value))} onClear={() => setViewTicks(view, {})} />
      <FilterWindow open={filterOpen && !small} onOpenChange={setFilterOpen} groups={g} ticks={t} counts={counts} onToggle={(group, value) => setViewTicks(view, toggleTick(t, group, value))} onClearGroup={(group) => setViewTicks(view, clearGroup(t, group))} onClearAll={() => setViewTicks(view, {})} summary={summary} show={show} />
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
          <>
            <StatusTiles tiles={tiles} selected={selected} onPick={pickTile} label="Follow-ups" idPrefix="follow-tile" panelId={PANEL_ID} testId="follow-tiles" className="mb-1.5" headerEnd />
            <section id={PANEL_ID} role="tabpanel" aria-labelledby={`follow-tile-${selected}`} className={CARD} data-testid="outreach-card">
              <TargetBar count={data.counter.count} target={data.counter.target} pct={data.counter.pct} hint="Counted from emails sent and calls logged, Mon to Fri" className="py-3.5" />
              {!followBase.length ? (
                <>
                  <div className="mx-[22px] h-px bg-rule" />
                  <Quiet testId="outreach-empty">Nobody here yet. Add a person to start keeping in touch.</Quiet>
                </>
              ) : (
                <StickySections under="page" className="px-[22px] pb-2.5">
                  <div data-testid="outreach-section" data-section={selected}>
                    <ListBand name={OUTREACH_SECTIONS.find((s) => s.key === selected)?.label ?? ""} count={listed.length} urgent={selected === "overdue"} hint={OUTREACH_SECTIONS.find((s) => s.key === selected)?.hint} testId="follow-band" />
                    {listed.length ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                        {listed.map((p) => (
                          <div key={p.id} className="border-t border-slate-100 first:border-t-0" data-testid="outreach-row">
                            <PersonRow person={p} today={today} onEmail={onEmailPerson} onCall={onCallPerson} done={logged[p.id]} />
                          </div>
                        ))}
                      </div>
                    ) : ticked || query.trim() ? (
                      <div className="-mx-[22px]">{noMatch("one")}</div>
                    ) : (
                      <div className="-mx-[22px]">
                        <Quiet testId="follow-empty">{FOLLOW_EMPTY[selected]} Pick another tile above.</Quiet>
                      </div>
                    )}
                  </div>
                </StickySections>
              )}
            </section>
          </>
        ) : null}

        {view === "people" ? (
          <WorkCard title="People" count={peopleRows.length || null} hint="A to Z" testId="everyone-card">
            <div className="flex flex-col pb-1" data-testid="everyone-rows">
              {peopleRows.map((p) => (
                <div key={p.id} className="border-t border-slate-100 first:border-t-0" data-testid="everyone-row" data-role={p.roleKey ?? ""}>
                  <PersonRow person={p} today={today} onEmail={onEmailPerson} onCall={onCallPerson} done={logged[p.id]} showDone={false} />
                </div>
              ))}
              {!peopleRows.length ? (peopleBase.length ? noMatch("one") : <Quiet testId="everyone-empty">No one here yet. Add a person to start keeping in touch.</Quiet>) : null}
            </div>
          </WorkCard>
        ) : null}

        {view === "orgs" ? (
          <WorkCard title="Organizations" count={orgRows.length || null} hint="A to Z" testId="orgs-card">
            <div className="flex flex-col pb-1" data-testid="org-rows">
              {orgRows.map((o) => (
                <OrgListRow key={o.id} org={o} today={today} canEmail={!!orgs.composes[o.id]} onEmail={() => setEmail({ key: o.id, setup: orgs.composes[o.id] })} done={logged[o.id]} />
              ))}
              {!orgRows.length ? (allOrgs.length ? noMatch("organization") : <Quiet testId="orgs-empty">No organizations yet. Add one, or type one on a person&apos;s Facts.</Quiet>) : null}
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
            setTimeout(() => router.refresh(), CONFIRM_SHORT_MS);
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
              <Figure value={org.peopleCount ? String(org.peopleCount) : "None"} label="People" col="people" testId="org-people" />
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
          {org.archived ? <Pill tone="charcoal">Archived</Pill> : null}
        </Line1>
        <Line2 className={org.peopleNames.length ? "text-slate-600" : "text-muted-foreground"}>{org.peopleNames.length ? peopleNamesLine(org.peopleNames) : "No people yet"}</Line2>
        {done ? <span className="mt-1.5 inline-block text-[12.5px] font-medium text-status-met">{done}</span> : null}
      </RowShell>
    </div>
  );
}

export { PEOPLE_HREF };
