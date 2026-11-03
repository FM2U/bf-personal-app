"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Phone } from "lucide-react";
import { addPersonNote, addPersonTask, archivePerson, completeFollowUp, deferFollowUp, deletePersonTask, logIncoming, makePersonTaskNext, reopenPerson, saveFollowUp, setPersonTaskDone, type PersonInput } from "@/app/actions/outreach";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { ComposeSetup } from "@/lib/compose-email";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { personAsk } from "@/lib/work/ask-ai";
import { followUpHint, lastContactLabel, nextDateChoices, purposesText } from "@/lib/work/outreach";
import { organizationHref } from "@/lib/work/people";
import type { IncomingReply, PersonRecordLink, PersonRow } from "@/lib/work/outreach-data";
import type { TimelineEvent } from "@/lib/work/timeline";
import type { DealTodo } from "@/lib/work/todos";
import { PersonFactsForm } from "@/components/app/work/add-person";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { Fact, GrowingTextarea, SaveLine, useSave, useSynced } from "@/components/app/work/deal/cards";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { PurposePills } from "@/components/app/work/person-row";
import { TasksCard } from "@/components/app/work/tasks-card";
import { TimelineEvents } from "@/components/app/work/timeline-list";
import { cappedNote, ShowAll } from "@/components/app/work/show-all";
import { Confirm, Pill, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the person page (/work/people/[id]) under the record-page rule (batch B, approved 2026-10-31).
 * Left: Why in touch (purpose and the one-line note; what the follow-up is for lives in Next follow-up as "What for"
 * since Edit batch C round 2), Next follow-up (date, what for, the AI star that suggests both; Save,
 * Done, Later), Tasks. Right: Facts (Edit), Incoming (Gmail replies not yet on the timeline, Log it), Timeline
 * (notes, emails, calls; Add a note below), Decision (Archive or Reopen). Each card saves through its own server
 * action; the page re-reads after a successful save.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

// ---------- Header ----------

export function PersonHeaderActions({ person, compose, today, tz }: { person: PersonRow; compose: ComposeSetup | null; today: string; tz: string }) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        {compose ? (
          <RowButton onClick={() => setEmailOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="person-page-email">
            <Mail className="mr-1.5 h-3.5 w-3.5" /> Email
          </RowButton>
        ) : null}
        <RowButton onClick={() => setCallOpen(true)} className="h-9 px-3.5 text-[13px]" data-testid="person-page-log-call">
          <Phone className="mr-1.5 h-3.5 w-3.5" /> Log a call
        </RowButton>
      </div>
      {note ? (
        <span className="text-[13px] font-medium text-status-met" role="status" data-testid="person-logged">
          {note}
        </span>
      ) : null}
      {compose && emailOpen ? (
        <ComposeEmailDialog
          setup={compose}
          open={emailOpen}
          onOpenChange={setEmailOpen}
          ask={personAsk(person)}
          onSent={() => {
            setNote("Email sent and logged on the timeline.");
            router.refresh();
          }}
        />
      ) : null}
      <LogCallDrawer
        target={{ contactId: person.id, dealId: null, who: person.name, from: `From ${person.name}'s page`, currentDate: person.nextFollowUp }}
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

// ---------- Why in touch (the type-specific card) ----------

export function WhyInTouchCard({ person }: { person: PersonRow }) {
  const line = (label: string, value: React.ReactNode, testId: string) => (
    <div className="grid grid-cols-1 gap-x-3.5 gap-y-0.5 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)]" data-testid={testId}>
      <span className={LABEL}>{label}</span>
      <span className="min-w-0 text-sm text-slate-900">{value}</span>
    </div>
  );
  return (
    <WorkCard title="Why in touch" hint="Edit in Facts" testId="person-why">
      <div className="flex flex-col px-[22px] pt-1 pb-3">
        {line("Purpose", person.purposes.length ? <span className="inline-flex flex-wrap gap-1.5"><PurposePills purposes={person.purposes} /></span> : <span className="text-slate-400">Not set</span>, "why-purpose")}
        {line("Note", person.note ?? <span className="text-slate-400">No note yet</span>, "why-note")}
      </div>
    </WorkCard>
  );
}

// ---------- Next follow-up ----------

export function NextFollowUpCard({ person, today }: { person: PersonRow; today: string }) {
  const ids = useId();
  const router = useRouter();
  const { pending, state, run } = useSave();
  const [date, setDate] = useSynced(person.nextFollowUp ?? "");
  const [what, setWhat] = useSynced(person.followUpFor ?? "");
  const [mode, setMode] = useState<"idle" | "done" | "later">("idle");
  const [acting, start] = useTransition();
  const [result, setResult] = useState<{ tone: "blue" | "warn"; text: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const dirty = date !== (person.nextFollowUp ?? "") || what !== (person.followUpFor ?? "");
  useUnsavedWork(dirty, "The next follow-up is not saved yet.");
  const hint = followUpHint(person.nextFollowUp, today, (d) => fmtDate(d, "MMM d"));
  const choices = nextDateChoices(today);
  const finish = (next: string | null) =>
    start(async () => {
      const r = await completeFollowUp(person.id, { date: next, what });
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setMode("idle");
      setResult({ tone: "blue", text: r.date ? `Done. Next follow-up: ${fmtDate(r.date, "EEE MMM d")}.` : "Done. No next date set." });
      router.refresh();
    });
  const later = (next: string) =>
    start(async () => {
      const r = await deferFollowUp(person.id, next);
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setMode("idle");
      setResult({ tone: "blue", text: `Moved to ${fmtDate(r.date, "EEE MMM d")}.` });
      router.refresh();
    });
  return (
    <WorkCard
      title="Next follow-up"
      actions={
        <>
          <span className="text-[13px] text-muted-foreground" data-testid="next-action-hint">{hint}</span>
          <AiCardStar
            context={{ ...personAsk(person), card: "Next follow-up" }}
            onUseNext={(x) => {
                setWhat(x.action);
                setDate(x.due);
              }}
            testId="next-action-star"
          />
        </>
      }
      testId="person-next-follow-up"
    >
      <div className={FORM} data-testid="follow-up-form">
        <label htmlFor={`${ids}-d`} className={LABEL}>
          Date
        </label>
        <input id={`${ids}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="fu-date" />
        <label htmlFor={`${ids}-w`} className={LABEL}>
          What for
        </label>
        <div className="relative min-w-0">
          <input id={`${ids}-w`} value={what} onChange={(e) => setWhat(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="What the follow-up is for" className={cn(INPUT, "pr-9")} data-testid="fu-what" />
          <AiFieldStar context={personAsk(person)} field={{ key: "next_action", label: "What for", current: what }} visible={!what.trim() || focused} onUse={setWhat} />
        </div>
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          {dirty ? (
            <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveFollowUp(person.id, { date, what }))} data-testid="fu-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          ) : (
            <div className="flex gap-1.5">
              <RowButton tone="cobalt" disabled={acting} onClick={() => setMode(mode === "done" ? "idle" : "done")} data-testid="fu-done">
                Done
              </RowButton>
              <RowButton disabled={acting} onClick={() => setMode(mode === "later" ? "idle" : "later")} data-testid="fu-later">
                Later
              </RowButton>
            </div>
          )}
        </SaveLine>
        {mode === "done" ? (
          <Confirm tone="blue" testId="fu-done-ask">
            <span>Done. Next follow-up:</span>
            {choices.map((c) => (
              <RowButton key={c.date} tone="cobalt" disabled={acting} onClick={() => finish(c.date)} data-testid="fu-done-choice" data-date={c.date}>
                {c.label((d) => fmtDate(d, "MMM d"))}
              </RowButton>
            ))}
            <span className="flex items-center gap-1.5">
              <input type="date" value={typed} min={addDaysISO(today, 1)} onChange={(e) => setTyped(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Or a date" data-testid="fu-done-date" />
              <RowButton disabled={acting || !typed} onClick={() => finish(typed)} data-testid="fu-done-save">
                Save
              </RowButton>
            </span>
            <RowButton disabled={acting} onClick={() => finish(null)} data-testid="fu-done-none">
              No date
            </RowButton>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </Confirm>
        ) : null}
        {mode === "later" ? (
          <Confirm tone="blue" testId="fu-later-choice">
            <span>Later:</span>
            <RowButton tone="cobalt" disabled={acting} onClick={() => later(addDaysISO(today, 1))} data-testid="fu-later-tomorrow">
              Tomorrow
            </RowButton>
            <span className="flex items-center gap-1.5">
              <input type="date" value={typed} min={addDaysISO(today, 1)} onChange={(e) => setTyped(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Pick a date" data-testid="fu-later-date" />
              <RowButton disabled={acting || !typed} onClick={() => later(typed)} data-testid="fu-later-pick">
                Move
              </RowButton>
            </span>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </Confirm>
        ) : null}
        {result ? (
          <Confirm tone={result.tone} testId="fu-result">
            <span>{result.text}</span>
          </Confirm>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Tasks ----------

export function PersonTasksCard({ person, tasks }: { person: PersonRow; tasks: DealTodo[] }) {
  return (
    <TasksCard
      windowTitle={`Tasks · ${person.name}`}
      tasks={tasks}
      open={!person.archived}
      actions={{
        add: (text) => addPersonTask(person.id, text),
        setDone: (id, done) => setPersonTaskDone(id, done),
        remove: (id) => deletePersonTask(id),
        makeNext: (id) => makePersonTaskNext(id),
      }}
      placeholder={`Something to do with ${person.name.split(" ")[0]}`}
      emptyText="Nothing yet. Add what else needs doing with this person; Make this the next action turns one into the next follow-up."
      testId="person-tasks"
      ai={personAsk(person)}
    />
  );
}

// ---------- Facts ----------

export function PersonFactsCard({ person, records, today }: { person: PersonRow; records: PersonRecordLink[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const initial: PersonInput = { name: person.name, organization: person.organization ?? "", role: person.roleKey ?? "other", title: person.title ?? "", purposes: [...person.purposes], email: person.email ?? "", phone: person.phone ?? "", linkedin: person.linkedin ?? "", nextFollowUp: "", note: person.note ?? "" };
  const link = person.linkedin ? (person.linkedin.startsWith("http") ? person.linkedin : `https://${person.linkedin}`) : null;
  return (
    <WorkCard
      title="Facts"
      actions={
        <RowButton onClick={() => setEditing((e) => !e)} data-testid="person-facts-edit">
          {editing ? "Cancel" : "Edit"}
        </RowButton>
      }
      testId="person-facts"
    >
      {editing ? (
        <PersonFactsForm
          personId={person.id}
          initial={initial}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            router.refresh();
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5" data-testid="person-facts-grid">
          <Fact label="Name" testId="pf-name">
            {person.name}
          </Fact>
          <Fact label="Organization" testId="pf-organization">
            {person.organization && person.organizationId ? (
              <Link href={organizationHref(person.organizationId)} className="block truncate text-primary-strong hover:underline" data-testid="person-org-link">
                {person.organization}
              </Link>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Role" testId="pf-role">
            {[person.roleLabel, person.title].filter(Boolean).join(", ") || "Not set"}
          </Fact>
          <Fact label="Purpose" testId="pf-purpose">
            {purposesText(person.purposes) || "Not set"}
          </Fact>
          <Fact label="Email" testId="pf-email">
            {person.email ? (
              <a href={`mailto:${person.email}`} className="block truncate text-primary-strong hover:underline">
                {person.email}
              </a>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Phone" testId="pf-phone">
            {person.phone ?? "Not set"}
          </Fact>
          <Fact label="LinkedIn" testId="pf-linkedin">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="block truncate text-primary-strong hover:underline">
                {link.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Last contact" testId="pf-last-contact">
            {lastContactLabel(person.lastContactOn, person.lastContactKind, today, (d) => fmtDate(d, "MMM d"))}
          </Fact>
          {records.length ? (
            <div className="col-span-2 flex min-w-0 flex-col gap-1" data-testid="pf-records">
              <span className="label-caps figure-label">Main contact on</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-[15.5px] font-semibold">
                {records.map((r) => (
                  <a key={r.id} href={r.href} className="text-primary-strong hover:underline">
                    {r.name}
                  </a>
                ))}
              </span>
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

// ---------- Incoming ----------

export function IncomingCard({ incoming }: { incoming: IncomingReply[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const list = incoming.filter((r) => !gone[r.id]);
  const log = (id: string) =>
    start(async () => {
      setError(null);
      const r = await logIncoming(id);
      if (!r.ok) return setError(r.error);
      setGone((m) => ({ ...m, [id]: true }));
      router.refresh();
    });
  return (
    <WorkCard title="Incoming" count={list.length} hint="Replies not yet on the timeline" testId="person-incoming">
      <div className="flex flex-col px-[22px] pt-1 pb-3">
        {list.length ? (
          <ShowAll
            items={list}
            title="Incoming"
            sub={`All ${list.length} replies not yet on the timeline, newest first`}
            text={(r) => `${r.subject} ${r.excerpt ?? ""}`}
            testId="incoming-all"
            wrap={(rows, inWindow) => <div className={inWindow ? "flex flex-col px-[22px]" : "contents"}>{rows}</div>}
            render={(r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 py-2.5 last:border-b-0" data-testid="incoming-row">
              <div className="min-w-0 flex-1 basis-[220px]">
                <div className="flex flex-wrap items-center gap-x-2.5">
                  <span className="text-sm font-semibold text-slate-900">{r.subject}</span>
                  <span className="text-xs text-muted-foreground">{r.date}</span>
                </div>
                {r.excerpt ? <div className="mt-0.5 text-[13px] text-slate-600 italic">&ldquo;{r.excerpt}&rdquo;</div> : null}
              </div>
              <RowButton tone="soft" disabled={pending} onClick={() => log(r.id)} data-testid="incoming-log">
                Log it
              </RowButton>
            </div>
            )}
          />
        ) : (
          <p className="py-2 text-[13px] text-muted-foreground" data-testid="incoming-empty">
            Nothing waiting. Replies pulled from Gmail will show here once Gmail reading is connected.
          </p>
        )}
        {error ? (
          <span className="pt-2 text-[13px] text-status-missed" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Timeline ----------

export function PersonTimelineCard({ person, events }: { person: PersonRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  return (
    <WorkCard title="Timeline" hint={["Newest first", cappedNote(events.length)].filter(Boolean).join(" · ")} testId="person-timeline">
      <TimelineEvents events={events} empty="Nothing yet. Notes, emails, and calls show here." windowTitle={`Timeline · ${person.name}`} windowSub={`All ${events.length} entries, newest first`} />
      <div className="flex flex-col gap-2 px-[22px] pt-2 pb-4" data-testid="note-form">
        <div className="flex items-start gap-2">
          <GrowingTextarea id="person-note" value={note} onChange={setNote} minRows={1} placeholder="Add a note" className="flex-1" data-testid="person-note" />
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addPersonNote(person.id, note), () => setNote(""))} className="h-9 shrink-0" data-testid="note-save">
            {pending ? "Saving..." : "Add"}
          </RowButton>
        </div>
        {state.kind === "error" ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="save-error">
            {state.text}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Decision ----------

export function PersonDecisionCard({ person }: { person: PersonRow }) {
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
    <WorkCard title="Decision" hint={person.archived ? "Archived; not on Contacts" : person.roleKey === "accountability_partner" ? "Archive stops their reports" : "Archive takes the person off Contacts"} testId="person-decision">
      <div className="flex flex-wrap items-center gap-2 px-[22px] pt-3 pb-5">
        {person.archived ? (
          <>
            <Pill tone="charcoal" testId="person-archived-pill">
              Archived
            </Pill>
            {person.archivedAt ? <span className="text-[13px] text-muted-foreground">{fmtDate(person.archivedAt, "MMM d, yyyy")}</span> : null}
            <RowButton tone="cobalt" onClick={() => act(() => reopenPerson(person.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="person-reopen">
              Reopen
            </RowButton>
          </>
        ) : (
          <RowButton onClick={() => act(() => archivePerson(person.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="person-archive">
            Archive
          </RowButton>
        )}
        {error ? (
          <span className="text-[13px] text-status-missed" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}
