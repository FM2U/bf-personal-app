"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { addOrgNote, addPersonToOrg, archiveOrganization, makeOrgTaskNext, orgNextActionDone, orgNextActionLater, reopenOrganization, saveOrgNextAction } from "@/app/actions/organizations";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { ComposeSetup } from "@/lib/compose-email";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { lastContactLabel, orgRoleLine } from "@/lib/work/outreach";
import type { PersonRow } from "@/lib/work/outreach-data";
import type { OrgDeal, OrgRow } from "@/lib/work/organizations-data";
import { personHref } from "@/lib/work/people";
import { dueLabel } from "@/lib/work/stages";
import type { TimelineEvent } from "@/lib/work/timeline";
import type { DealTodo } from "@/lib/work/todos";
import { OrgFactsForm } from "@/components/app/work/add-organization";
import { Fact, GrowingTextarea, SaveLine, useSave, useSynced } from "@/components/app/work/deal/cards";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { TasksCard } from "@/components/app/work/tasks-card";
import { TimelineEvents } from "@/components/app/work/timeline-list";
import { cappedNote, ShowAll } from "@/components/app/work/show-all";
import { Confirm, Figure, Line1, Line2, Name, Pill, ProgressMark, ROW_COLS, RowButton, RowShell, What, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the organization page (/work/people/organizations/[id], push B) under the record-page rule. Left:
 * People (the people at the firm; "+ Add a person" moves someone here or adds a new name), Next action (action, due,
 * Save, Done, Later), Tasks. Right: Facts (Edit), Deals (from this firm: its own deals and those whose main contact
 * works there), Timeline (notes, emails, and calls of everyone at the firm; Add a note), Decision (Archive or Reopen).
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

// ---------- Header ----------

export function OrgHeaderActions({ org, compose, today, tz }: { org: OrgRow; compose: ComposeSetup | null; today: string; tz: string }) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        {compose ? (
          <RowButton onClick={() => setEmailOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="org-page-email">
            <Mail className="mr-1.5 h-3.5 w-3.5" /> Email
          </RowButton>
        ) : null}
        <RowButton onClick={() => setCallOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="org-page-log-call">
          <Phone className="mr-1.5 h-3.5 w-3.5" /> Log a call
        </RowButton>
      </div>
      {note ? (
        <span className="text-[13px] font-medium text-status-met" role="status" data-testid="org-logged">
          {note}
        </span>
      ) : null}
      {compose && emailOpen ? (
        <ComposeEmailDialog
          setup={compose}
          open={emailOpen}
          onOpenChange={setEmailOpen}
          onSent={() => {
            setNote("Email sent and logged on the timeline.");
            router.refresh();
          }}
        />
      ) : null}
      <LogCallDrawer
        target={{ contactId: null, dealId: null, organizationId: org.id, who: "", from: `From ${org.name}'s page`, currentDate: org.nextActionDue }}
        today={today}
        tz={tz}
        open={callOpen}
        onOpenChange={setCallOpen}
        onSaved={(r) => {
          setNote(`Call logged on the timeline, ${r.minutes} min.`);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------- People at the firm (the type-specific card) ----------

export function OrgPeopleCard({ org, people, others, today }: { org: OrgRow; people: PersonRow[]; others: { id: string; name: string; organization: string | null }[]; today: string }) {
  const ids = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const live = people.filter((p) => !p.archived);
  const add = () =>
    start(async () => {
      setError(null);
      const r = await addPersonToOrg(org.id, pick ? { contactId: pick } : { name });
      if (!r.ok) return setError(r.error);
      setPick("");
      setName("");
      setOpen(false);
      router.refresh();
    });
  return (
    <WorkCard
      title="People"
      count={live.length || null}
      actions={
        !org.archived ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="org-add-person">
            {open ? "Cancel" : "+ Add a person"}
          </button>
        ) : null
      }
      testId="org-people"
    >
      {open ? (
        <div className="flex flex-col gap-2.5 border-b border-slate-100 bg-primary-soft/40 px-[22px] py-3" data-testid="org-add-person-form">
          <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[110px_minmax(0,1fr)]">
            <label htmlFor={`${ids}-pick`} className={LABEL}>
              Someone you know
            </label>
            <select id={`${ids}-pick`} value={pick} onChange={(e) => setPick(e.target.value)} className={INPUT} data-testid="org-pick-person">
              <option value="">Pick a person</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.organization ? ` (now at ${p.organization})` : ""}
                </option>
              ))}
            </select>
            <label htmlFor={`${ids}-name`} className={LABEL}>
              Or a new person
            </label>
            <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} disabled={!!pick} placeholder="First and last name" className={INPUT} data-testid="org-new-person" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error ? (
              <span className="mr-auto text-[13px] text-status-missed" role="alert">
                {error}
              </span>
            ) : null}
            <RowButton tone="primary" disabled={pending || (!pick && !name.trim())} onClick={add} data-testid="org-add-person-save">
              {pending ? "Adding..." : "Add to this organization"}
            </RowButton>
          </div>
        </div>
      ) : null}
      {live.length ? (
        <ShowAll
          items={live}
          title={`People · ${org.name}`}
          sub={`All ${live.length} people at this organization, A to Z`}
          text={(p) => `${p.name} ${p.title ?? ""} ${p.note ?? ""}`}
          testId="org-people-all"
          wrap={(rows) => <div className="flex flex-col pb-1" data-testid="org-people-rows">{rows}</div>}
          render={(p) => {
            const line = orgRoleLine({ ...p, organization: null });
            return (
              <RowShell
                key={p.id}
                testId="org-person-row"
                href={personHref(p.id)}
                right={<Figure value={lastContactLabel(p.lastContactOn, p.lastContactKind, today, (d) => fmtDate(d, "MMM d"))} label="Last contact" col="lastContact" />}
              >
                <Line1>
                  <Name>{p.name}</Name>
                  {line ? <What>{line}</What> : null}
                </Line1>
                {p.note ? <Line2 className="text-slate-600">{p.note}</Line2> : null}
              </RowShell>
            );
          }}
        />
      ) : (
        <div className="flex flex-col pb-1" data-testid="org-people-rows">
          <p className="px-[22px] py-3 text-[13px] text-muted-foreground">No one at this organization yet. Add a person, or set the organization on a person&apos;s Facts.</p>
        </div>
      )}
    </WorkCard>
  );
}

// ---------- Next action ----------

export function OrgNextActionCard({ org, today }: { org: OrgRow; today: string }) {
  const ids = useId();
  const router = useRouter();
  const { pending, state, run } = useSave();
  const [action, setAction] = useSynced(org.nextAction ?? "");
  const [due, setDue] = useSynced(org.nextActionDue ?? "");
  const [mode, setMode] = useState<"idle" | "later">("idle");
  const [typed, setTyped] = useState("");
  const [acting, start] = useTransition();
  const [result, setResult] = useState<{ tone: "blue" | "warn"; text: string } | null>(null);
  const dirty = action !== (org.nextAction ?? "") || due !== (org.nextActionDue ?? "");
  useUnsavedWork(dirty, "The next action is not saved yet.");
  const hint = org.nextAction ? (org.nextActionDue ? `Due ${dueLabel(org.nextActionDue, today, (d) => fmtDate(d, "MMM d")).text}` : "No date") : "None set";
  const act = (fn: () => Promise<{ ok: true; date?: string } | { ok: false; error: string }>, text: (r: { date?: string }) => string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setMode("idle");
      setResult({ tone: "blue", text: text(r) });
      router.refresh();
    });
  return (
    <WorkCard title="Next action" actions={<span className="text-[13px] text-muted-foreground" data-testid="org-next-hint">{hint}</span>} testId="org-next-action">
      <div className={FORM}>
        <label htmlFor={`${ids}-a`} className={LABEL}>
          Action
        </label>
        <input id={`${ids}-a`} value={action} onChange={(e) => setAction(e.target.value)} placeholder="The next thing to do with this organization" className={INPUT} data-testid="org-next-action-input" />
        <label htmlFor={`${ids}-d`} className={LABEL}>
          Due
        </label>
        <input id={`${ids}-d`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="org-next-due" />
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          {dirty ? (
            <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveOrgNextAction(org.id, { action, due }))} data-testid="org-next-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          ) : org.nextAction ? (
            <div className="flex gap-1.5">
              <RowButton tone="cobalt" disabled={acting} onClick={() => act(() => orgNextActionDone(org.id), () => "Done. Set the next one when you know it.")} data-testid="org-next-done">
                Done
              </RowButton>
              <RowButton disabled={acting} onClick={() => setMode(mode === "later" ? "idle" : "later")} data-testid="org-next-later">
                Later
              </RowButton>
            </div>
          ) : null}
        </SaveLine>
        {mode === "later" ? (
          <Confirm tone="blue" testId="org-later-choice">
            <span>Later:</span>
            <RowButton tone="cobalt" disabled={acting} onClick={() => act(() => orgNextActionLater(org.id, addDaysISO(today, 1)), (r) => `Moved to ${fmtDate(r.date!, "EEE MMM d")}.`)}>
              Tomorrow
            </RowButton>
            <span className="flex items-center gap-1.5">
              <input type="date" value={typed} min={addDaysISO(today, 1)} onChange={(e) => setTyped(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Pick a date" />
              <RowButton disabled={acting || !typed} onClick={() => act(() => orgNextActionLater(org.id, typed), (r) => `Moved to ${fmtDate(r.date!, "EEE MMM d")}.`)}>
                Move
              </RowButton>
            </span>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </Confirm>
        ) : null}
        {result ? (
          <Confirm tone={result.tone} testId="org-next-result">
            <span>{result.text}</span>
          </Confirm>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Tasks ----------

export function OrgTasksCard({ org, tasks, today }: { org: OrgRow; tasks: DealTodo[]; today: string }) {
  return (
    <TasksCard
      windowTitle={`Tasks · ${org.name}`}
      tasks={tasks}
      open={!org.archived}
      record={{ kind: "organization", id: org.id }}
      today={today}
      actions={{ makeNext: (id) => makeOrgTaskNext(id) }}
      placeholder={`Something to do with ${org.name}`}
      emptyText="Nothing yet. Add what else needs doing with this organization; Make this the next action moves one into Next action."
      testId="org-tasks"
    />
  );
}

// ---------- Facts ----------

export function OrgFactsCard({ org }: { org: OrgRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const site = org.website ? (org.website.startsWith("http") ? org.website : `https://${org.website}`) : null;
  return (
    <WorkCard
      title="Facts"
      actions={
        <RowButton onClick={() => setEditing((e) => !e)} data-testid="org-facts-edit">
          {editing ? "Cancel" : "Edit"}
        </RowButton>
      }
      testId="org-facts"
    >
      {editing ? (
        <OrgFactsForm
          orgId={org.id}
          initial={{ name: org.name, kind: org.kind, region: org.region ?? "", website: org.website ?? "", phone: org.phone ?? "", dealSize: org.dealSize ?? "", note: org.note ?? "" }}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            router.refresh();
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5" data-testid="org-facts-grid">
          <Fact label="Kind" testId="of-kind">
            {org.kindLabel}
          </Fact>
          <Fact label="Region" testId="of-region">
            {org.region ?? "Not set"}
          </Fact>
          <Fact label="Website" testId="of-website">
            {site ? (
              <a href={site} target="_blank" rel="noreferrer" className="block truncate text-primary-strong hover:underline">
                {site.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Phone" testId="of-phone">
            {org.phone ?? "Not set"}
          </Fact>
          <Fact label="Deal size" testId="of-deal-size">
            {org.dealSize ?? "Not set"}
          </Fact>
          <Fact label="Since" testId="of-since">
            {org.createdAt ? fmtDate(org.createdAt, "MMM yyyy") : "Not set"}
          </Fact>
          {org.note ? (
            <div className="col-span-2">
              <Fact label="What they do" testId="of-note">
                {org.note}
              </Fact>
            </div>
          ) : null}
          {saved ? (
            <span className="col-span-2 text-[13px] font-medium text-status-met" role="status" data-testid="save-ok">
              Saved
            </span>
          ) : null}
        </div>
      )}
    </WorkCard>
  );
}

// ---------- Deals ----------

export function OrgDealsCard({ deals, passed, orgName }: { deals: OrgDeal[]; passed: OrgDeal[]; orgName: string }) {
  const passedLine = passed.length ? `${passed.length} closed: ${passed.slice(0, 3).map((p) => `${p.name}${p.passReason ? ` (${p.passReason})` : ""}`).join(", ")}${passed.length > 3 ? ` and ${passed.length - 3} more` : ""}` : null;
  return (
    <WorkCard title="Deals" count={deals.length || null} hint="From this organization" testId="org-deals">
      {deals.length ? (
        <ShowAll
          items={deals}
          title={`Deals · ${orgName}`}
          sub={`All ${deals.length} open deals from this organization`}
          text={(d) => `${d.name} ${d.stageName ?? ""} ${d.contactName ?? ""}`}
          testId="org-deals-all"
          wrap={(rows) => <div className="flex flex-col pb-1" data-testid="org-deal-rows">{rows}</div>}
          render={(d) => (
            <RowShell key={d.id} testId="org-deal-row" href={d.href}>
              <Line1>
                {d.lane === "Deals" ? <ProgressMark stage={d.stageName} /> : <Pill tone="blue">{d.lane}</Pill>}
                <Name>{d.name}</Name>
                {d.waitingOn && d.waitLevel !== "none" ? (
                  <Pill tone={d.waitLevel === "red" ? "red" : d.waitLevel === "amber" ? "amber" : "gray"}>
                    {d.waitDays} {d.waitDays === 1 ? "day" : "days"}
                  </Pill>
                ) : null}
              </Line1>
              <Line2 className="text-slate-600">{[d.stageName, d.waitingOn ? `waiting on ${/^[A-Z](?![A-Z])/.test(d.waitingOn) && !/^[A-Z][a-z]+ [A-Z][a-z]/.test(d.waitingOn) ? d.waitingOn[0].toLowerCase() + d.waitingOn.slice(1) : d.waitingOn}` : d.nextAction, d.contactName].filter(Boolean).join(" · ")}</Line2>
            </RowShell>
          )}
        />
      ) : (
        <div className="flex flex-col pb-1" data-testid="org-deal-rows">
          <p className="px-[22px] py-3 text-[13px] text-muted-foreground">No open deal from this organization.</p>
        </div>
      )}
      {passedLine ? (
        <p className="border-t border-slate-100 px-[22px] py-2.5 text-[12.5px] text-muted-foreground" data-testid="org-passed">
          {passedLine}
        </p>
      ) : null}
    </WorkCard>
  );
}

// ---------- Timeline ----------

export function OrgTimelineCard({ org, events }: { org: OrgRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  return (
    <WorkCard title="Timeline" hint={["Everyone at this organization, newest first", cappedNote(events.length)].filter(Boolean).join(" · ")} testId="org-timeline">
      <TimelineEvents events={events} empty="Nothing yet. Notes, emails, and calls with anyone at this organization show here." windowTitle={`Timeline · ${org.name}`} windowSub={`All ${events.length} entries, everyone at this organization, newest first`} />
      <div className="flex flex-col gap-2 px-[22px] pt-2 pb-4" data-testid="org-note-form">
        <div className="flex items-start gap-2">
          <GrowingTextarea id="org-note" value={note} onChange={setNote} minRows={1} placeholder="Add a note" className="flex-1" data-testid="org-note" />
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addOrgNote(org.id, note), () => setNote(""))} className={cn("h-9 shrink-0", ROW_COLS.button.cls)} data-testid="org-note-save">
            {pending ? "Saving..." : "Add"}
          </RowButton>
        </div>
        {state.kind === "error" ? (
          <span className="text-[13px] text-status-missed" role="alert">
            {state.text}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Decision ----------

export function OrgDecisionCard({ org }: { org: OrgRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Not saved.");
      router.refresh();
    });
  return (
    <WorkCard title="Decision" hint={org.archived ? "Archived; not on Organizations" : "Archive takes the organization off Contacts"} testId="org-decision">
      <div className="flex flex-wrap items-center gap-2 px-[22px] pt-3 pb-5">
        {org.archived ? (
          <>
            <Pill tone="charcoal" testId="org-archived-pill">
              Archived
            </Pill>
            {org.archivedAt ? <span className="text-[13px] text-muted-foreground">{fmtDate(org.archivedAt, "MMM d, yyyy")}</span> : null}
            <RowButton tone="cobalt" onClick={() => act(() => reopenOrganization(org.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="org-reopen">
              Reopen
            </RowButton>
          </>
        ) : (
          <RowButton onClick={() => act(() => archiveOrganization(org.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="org-archive">
            Archive
          </RowButton>
        )}
        {error ? (
          <span className="text-[13px] text-status-missed" role="alert">
            {error}
          </span>
        ) : null}
        <Link href="/work/people?view=orgs" className="ml-auto text-[12.5px] text-muted-foreground hover:underline">
          Back to Organizations
        </Link>
      </div>
    </WorkCard>
  );
}
