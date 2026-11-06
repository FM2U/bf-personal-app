"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveReportChoices, saveReportNote } from "@/app/actions/accountability";
import type { PartnerCopy } from "@/lib/accountability/data";
import { daysLabel } from "@/lib/accountability/partners";
import { closingHtml, greetingHtml, headerHtml, noteHtml, sectionBodyHtml } from "@/lib/accountability/report-email";
import { buildSections, NOTE_MAX, TOP_N, type BuiltSection, type ReportChoices, type ReportNotes, type SectionKey } from "@/lib/accountability/report-sections";
import { personHref } from "@/lib/work/people";
import { CenteredWindow } from "@/components/app/window";
import { cn } from "@/lib/utils";

/**
 * The report window on End of day (Push B edits, 2026-11-03): a large centered window (820px, 64px sides) with the
 * email exactly as it will be sent, one tab per partner when two are due. Each section has an include box (ticked
 * from that partner's standing sections), Change (which items the section shows today; for Top 3 deals, which 3
 * deals), and Edit (rewrite the section's text for today; "Use the app's text" undoes it). Tomorrow's line has Edit
 * only. Every choice applies to today's report only and is saved with the day's End of day row for that partner; the
 * sent email is built from the same choices (src/lib/accountability/report-sections.ts).
 */
/** The partner checkbox (fix list item 1, 2026-11-06), on the report card and in this window: cobalt when ticked. */
export const PARTNER_BOX = "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-primary-strong disabled:cursor-default disabled:opacity-60";

/**
 * Text typed in a + Note box or an Edit box and not saved yet (Bram, 2026-11-06). Leaving the window (Close, the close
 * mark, Escape, a click outside, another partner's tab, a link inside) or Approve and send first asks: Save, Discard
 * (Send without it), or Keep editing. Reloading or closing the browser tab gets the browser's own "Leave site?" question.
 */
type Unsaved = { items: { kind: "note" | "edit"; title: string }[]; save: () => Promise<boolean>; discard: () => void };
type LeaveTo = { to: "close" } | { to: "tab"; id: string; name: string } | { to: "link"; href: string } | { to: "send"; btn: HTMLButtonElement };

function unsavedLine(items: Unsaved["items"]): string {
  const parts = items.map((i) => (i.kind === "note" ? `note in the ${i.title} section` : `edit to the ${i.title} section`));
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and your ${parts[parts.length - 1]}`;
  return `Your ${joined} ${parts.length === 1 ? "is" : "are"} not saved.`;
}

function unsavedHint(to: LeaveTo, many: boolean): string {
  const it = many ? "them" : "it";
  if (to.to === "send") return `Save ${it} so ${many ? "they go" : "it goes"} out with the report, or send the report without ${it}.`;
  if (to.to === "tab") return `Save ${it} before you switch to ${to.name}'s copy, or discard ${it}.`;
  if (to.to === "link") return `Save ${it} before you leave the window, or discard ${it}.`;
  return `Save ${it} before the window closes, or discard ${it}.`;
}

export function ReportWindow({ open, onOpenChange, day, copies, skipped, onPartner, sel, onSel, title, sub, footerNote, sendButton, startEditing, resetKey = 0 }: {
  /** Fix list item 1 (2026-11-06): the partners unticked for today, the same set as the report card's checkboxes. */
  skipped?: ReadonlySet<string>;
  /** Ticks or unticks a partner for today; null once the day is closed. */
  onPartner?: ((id: string, on: boolean) => void) | null;
  /** Bumped when the choices were set from outside the window (the short version), so the window reads them again. */
  resetKey?: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  day: string;
  copies: PartnerCopy[];
  sel: string | null;
  onSel: (id: string) => void;
  title: string;
  sub: string;
  /** The gap line ("1 reason still needed. Gaps go out as ..."), or the send check. */
  footerNote: React.ReactNode;
  /** Approve and send (absent once the day is closed). */
  sendButton: React.ReactNode;
  /** Opened from Edit on the card: the first section opens for editing. */
  startEditing?: boolean;
}) {
  const copy = copies.find((c) => c.partner.id === sel) ?? copies[0] ?? null;
  const router = useRouter();
  const unsaved = useRef<Unsaved | null>(null);
  const passSend = useRef(false);
  const [warn, setWarn] = useState<{ to: LeaveTo; items: Unsaved["items"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (to: LeaveTo) => {
    const u = unsaved.current;
    if (!u) return false;
    setWarn({ to, items: u.items });
    return true;
  };
  const go = (to: LeaveTo) => {
    setWarn(null);
    if (to.to === "close") onOpenChange(false);
    else if (to.to === "tab") onSel(to.id);
    else if (to.to === "link") router.push(to.href);
    else {
      passSend.current = true;
      to.btn.click();
      passSend.current = false;
    }
  };
  const saveThenGo = async () => {
    if (!warn || busy) return;
    const to = warn.to;
    setBusy(true);
    const ok = (await unsaved.current?.save()) ?? true;
    setBusy(false);
    if (ok) go(to);
    else setWarn(null);
  };
  const discardThenGo = () => {
    if (!warn || busy) return;
    unsaved.current?.discard();
    go(warn.to);
  };
  const openChange = (o: boolean) => {
    if (o) return onOpenChange(true);
    if (busy) return;
    // Escape or a click outside while the question shows: back to the box.
    if (warn) return setWarn(null);
    if (ask({ to: "close" })) return;
    onOpenChange(false);
  };
  useEffect(() => {
    if (!open) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [open]);
  const sending = warn?.to.to === "send";
  const many = (warn?.items.length ?? 0) > 1;
  // Today's notes, shared by every tab: read again whenever the page brings back different ones from the server.
  const serverNotes = (copies.find((c) => !c.sentAt) ?? copies[0])?.report.notes ?? {};
  const serverKey = JSON.stringify(serverNotes);
  const [seenKey, setSeenKey] = useState(serverKey);
  const [notes, setNotes] = useState<ReportNotes>(serverNotes);
  if (seenKey !== serverKey) {
    setSeenKey(serverKey);
    setNotes(serverNotes);
  }
  return (
    <CenteredWindow
      open={open}
      onOpenChange={openChange}
      title={title}
      sub={sub}
      size="report"
      testId="report-window"
      overlay={
        warn ? (
          <div role="alertdialog" aria-labelledby="unsaved-title" aria-describedby="unsaved-hint" className="w-full max-w-[440px] rounded-[12px] border border-rule bg-white p-5 shadow-[0_12px_40px_rgba(15,23,42,0.18)]" data-testid="unsaved-warning" data-to={warn.to.to}>
            <p id="unsaved-title" className="text-[15px] font-semibold text-heading" data-testid="unsaved-line">
              {unsavedLine(warn.items)}
            </p>
            <p id="unsaved-hint" className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
              {unsavedHint(warn.to, many)}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => setWarn(null)} disabled={busy} className="inline-flex h-8 items-center rounded-[7px] px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50" data-testid="unsaved-keep">
                Keep editing
              </button>
              <button type="button" onClick={discardThenGo} disabled={busy} className="inline-flex h-8 items-center rounded-[7px] border border-input bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50" data-testid="unsaved-discard">
                {sending ? "Send without it" : "Discard"}
              </button>
              <button type="button" onClick={saveThenGo} disabled={busy} autoFocus className="inline-flex h-8 items-center rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[13px] font-medium text-white hover:bg-primary-solid-hover disabled:opacity-50" data-testid="unsaved-save">
                {busy ? "Saving…" : sending ? "Save and send" : "Save"}
              </button>
            </div>
          </div>
        ) : null
      }
      footer={
        <>
          <span className="min-w-0 flex-1 basis-full text-[12.5px] text-muted-foreground min-[701px]:basis-[260px]" data-testid="report-window-note">
            {footerNote}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => openChange(false)} className="inline-flex h-8 items-center rounded-[7px] border border-input bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50" data-testid="report-window-close">
              Close
            </button>
            <span
              className="contents"
              onClickCapture={(e) => {
                if (passSend.current) return;
                const btn = (e.target as HTMLElement).closest("button");
                if (btn && !btn.disabled && ask({ to: "send", btn })) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {sendButton}
            </span>
          </span>
        </>
      }
    >
      <div
        onClickCapture={(e) => {
          // A link inside the window (the partner's page) with text not saved: ask first.
          const a = (e.target as HTMLElement).closest("a[href]");
          const href = a?.getAttribute("href");
          if (href && ask({ to: "link", href })) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
      {copies.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-700" data-testid="report-send-to">
          <span className="label-caps figure-label">Send to</span>
          {copies.map((c) => {
            const on = !skipped?.has(c.partner.id);
            return (
              <label key={c.partner.id} className={cn("inline-flex items-center gap-2", onPartner && !c.sentAt ? "cursor-pointer" : "cursor-default", !on && "text-slate-400")} data-testid="report-send-to-partner" data-partner={c.partner.first} data-on={on ? "1" : "0"}>
                <input type="checkbox" checked={on} disabled={!onPartner || !!c.sentAt} onChange={(e) => onPartner?.(c.partner.id, e.target.checked)} className={PARTNER_BOX} data-testid="report-send-to-check" />
                {c.partner.name}
                {c.sentAt ? <span className="text-muted-foreground">(sent {c.sentTime})</span> : !on ? <span>(skipped today)</span> : null}
              </label>
            );
          })}
        </div>
      ) : null}
      {copies.length > 1 ? (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" data-testid="report-tabs">
          {copies.map((c) => (
            <button key={c.partner.id} type="button" role="tab" aria-selected={c.partner.id === copy?.partner.id} onClick={() => c.partner.id === copy?.partner.id || ask({ to: "tab", id: c.partner.id, name: c.partner.first }) || onSel(c.partner.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-[14px] font-medium whitespace-nowrap", c.partner.id === copy?.partner.id ? "border-primary-strong text-primary-strong" : "border-transparent text-muted-foreground hover:text-slate-800")} data-testid="report-tab" data-partner={c.partner.first}>
              {c.partner.name}
              <span className="ml-1 font-normal text-muted-foreground">· {c.sentAt ? `sent ${c.sentTime}` : daysLabel(c.partner.days) === "every weekday" ? "weekdays" : daysLabel(c.partner.days)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {copy ? <CopyReview key={`${copy.partner.id}:${resetKey}`} day={day} copy={copy} startEditing={!!startEditing} notes={notes} onNotes={setNotes} unsavedRef={unsaved} /> : <p className="text-[13px] text-muted-foreground">No partner gets the report today.</p>}
      </div>
    </CenteredWindow>
  );
}

const LINK = "text-[12.5px] font-medium text-primary-strong hover:underline";

/** One partner's copy: the note, then the email with the controls on each section (or the email as sent). */
function CopyReview({ day, copy, startEditing, notes, onNotes, unsavedRef }: { day: string; copy: PartnerCopy; startEditing: boolean; notes: ReportNotes; onNotes: (n: ReportNotes) => void; unsavedRef: React.RefObject<Unsaved | null> }) {
  const router = useRouter();
  const p = copy.partner;
  const [choices, setChoices] = useState<ReportChoices>(copy.report.choices ?? {});
  const [picking, setPicking] = useState<SectionKey | null>(null);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState("");
  const [noting, setNoting] = useState<SectionKey | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const report = { ...copy.report, choices, notes };
  const sections = buildSections(report);
  const [opened, setOpened] = useState(false);
  if (startEditing && !opened && !copy.sentAt) {
    setOpened(true);
    const first = sections.find((s) => s.included);
    if (first) {
      setEditing(first.key);
      setDraft(first.edited ?? first.text);
    }
  }

  const persistChoices = async (next: ReportChoices) => {
    setChoices(next);
    setError(null);
    const r = await saveReportChoices(day, p.id, next);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    router.refresh();
    return true;
  };
  const save = (next: ReportChoices) => {
    // Shown at once (outside the transition), so a ticked box stays ticked while it saves.
    setChoices(next);
    start(async () => {
      await persistChoices(next);
    });
  };
  const setInclude = (s: BuiltSection, on: boolean) => {
    const inc = { ...(choices.include ?? {}) };
    if (on === s.standing) delete inc[s.key];
    else inc[s.key] = on;
    if (!on && picking === s.key) setPicking(null);
    if (!on && editing === s.key) setEditing(null);
    if (!on && noting === s.key) setNoting(null);
    save({ ...choices, include: inc });
  };
  const toggleItem = (s: BuiltSection, id: string) => {
    const hid = new Set(choices.hidden?.[s.key] ?? []);
    if (hid.has(id)) hid.delete(id);
    else hid.add(id);
    save({ ...choices, hidden: { ...(choices.hidden ?? {}), [s.key]: [...hid] } });
  };
  const toggleTop = (s: BuiltSection, id: string) => {
    const now = (s.pick ?? []).filter((x) => x.on).map((x) => x.id);
    const next = now.includes(id) ? now.filter((x) => x !== id) : now.length < TOP_N ? [...now, id] : now;
    save({ ...choices, top: next });
  };
  const editsWith = (s: BuiltSection): ReportChoices => {
    const text = draft.replace(/\s+$/, "");
    const edits = { ...(choices.edits ?? {}) };
    if (!text.trim() || text === s.text) delete edits[s.key];
    else edits[s.key] = text;
    return { ...choices, edits };
  };
  const saveEdit = (s: BuiltSection) => {
    setEditing(null);
    save(editsWith(s));
  };
  const persistNote = async (key: SectionKey, text: string) => {
    const t = text.trim();
    const next = { ...notes };
    if (t) next[key] = t;
    else delete next[key];
    setNoting(null);
    onNotes(next);
    setError(null);
    const r = await saveReportNote(day, key, t);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    onNotes(r.notes);
    router.refresh();
    return true;
  };
  const saveNote = (key: SectionKey, text: string) => {
    // The box closes and the note shows at once, as before; the server's copy follows.
    const t = text.trim();
    const next = { ...notes };
    if (t) next[key] = t;
    else delete next[key];
    setNoting(null);
    onNotes(next);
    start(async () => {
      await persistNote(key, text);
    });
  };
  const openNote = (s: BuiltSection) => {
    setNoting(s.key);
    setNoteDraft(s.note ?? "");
  };
  const backToAppText = (s: BuiltSection) => {
    const edits = { ...(choices.edits ?? {}) };
    delete edits[s.key];
    setEditing(null);
    save({ ...choices, edits });
  };

  // Text typed in the open + Note or Edit box and not saved (2026-11-06): the window asks before leaving or sending.
  const noteSec = noting && !copy.sentAt ? sections.find((s) => s.key === noting && s.included) : undefined;
  const editSec = editing && !copy.sentAt ? sections.find((s) => s.key === editing && s.included) : undefined;
  const noteDirty = !!noteSec && noteDraft.trim() !== (noteSec.note ?? "").trim();
  const editDirty = !!editSec && draft.replace(/\s+$/, "") !== (editSec.edited ?? editSec.text).replace(/\s+$/, "");
  useEffect(() => {
    unsavedRef.current =
      noteDirty || editDirty
        ? {
            items: [...(noteDirty && noteSec ? [{ kind: "note" as const, title: noteSec.title }] : []), ...(editDirty && editSec ? [{ kind: "edit" as const, title: editSec.title }] : [])],
            save: async () => {
              let ok = true;
              if (noteDirty && noteSec) ok = (await persistNote(noteSec.key, noteDraft)) && ok;
              if (editDirty && editSec) {
                setEditing(null);
                ok = (await persistChoices(editsWith(editSec))) && ok;
              }
              return ok;
            },
            discard: () => {
              setNoting(null);
              setEditing(null);
            },
          }
        : null;
  });
  useEffect(() => () => void (unsavedRef.current = null), [unsavedRef]);

  if (copy.sentAt) {
    return (
      <>
        <p className="mb-2.5 text-[12.5px] text-muted-foreground">
          Sent to {p.name} at {copy.sentTime}. A sent report never changes.
        </p>
        <div className="report-preview report-window report-sent min-w-0 overflow-x-auto text-[13px] text-slate-900" dangerouslySetInnerHTML={{ __html: copy.html }} data-testid="report-preview" />
      </>
    );
  }

  return (
    <>
      <p className="mb-2.5 text-[12.5px] leading-[1.5] text-muted-foreground" data-testid="report-meta">
        To {p.name}
        {p.email ? ` (${p.email})` : ", no email address yet"}. Unticking a section applies to today only;{" "}
        <Link href={personHref(p.id)} className="font-medium text-primary-strong hover:underline" data-testid="report-partner-link">
          {p.first}&apos;s page
        </Link>{" "}
        keeps the standing choice. Edit changes that section&apos;s text for today only. + Note adds a few lines under a section, in every copy that includes it.
      </p>
      {error ? (
        <p className="mb-2 rounded-md bg-status-missed-bg px-3 py-2 text-[13px] text-status-missed" role="alert">
          {error}
        </p>
      ) : null}
      <div className="report-preview report-window min-w-0 text-[13px] leading-[1.45] text-slate-900" data-testid="report-preview" data-edited={copy.edited ? "1" : "0"}>
        <div dangerouslySetInnerHTML={{ __html: headerHtml(report) }} />
        <div dangerouslySetInnerHTML={{ __html: greetingHtml(report) }} />
        {sections.map((s) => (
          <div key={s.key} className="mt-3" data-testid="report-section" data-section={s.key} data-included={s.included ? "1" : "0"} data-edited={s.edited ? "1" : "0"} data-note={s.note ? "1" : "0"}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-slate-100 pb-1">
              <label className="inline-flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5">
                <input type="checkbox" checked={s.included} onChange={(e) => setInclude(s, e.target.checked)} className="h-[15px] w-[15px] accent-[var(--primary)]" aria-label={`Include ${s.title}`} data-testid="section-include" />
                <span className={cn("text-[11px] font-semibold tracking-[0.09em] uppercase", s.included ? "text-heading" : "text-slate-400")}>{s.title}</span>
                {!s.included ? (
                  <span className="text-[11.5px] font-medium text-status-soon">{s.note ? "Left out today, note not sent" : "Left out today"}</span>
                ) : (
                  <>
                    {s.edited ? <span className="text-[11.5px] font-medium text-primary-strong">Edited</span> : null}
                    {s.note ? (
                      <span className="text-[11.5px] font-medium text-primary-strong" data-testid="section-note-mark">
                        Note added
                      </span>
                    ) : null}
                  </>
                )}
              </label>
              {s.included ? (
                <span className="ml-auto flex shrink-0 gap-3">
                  {s.choices || s.pick ? (
                    <button type="button" onClick={() => setPicking((k) => (k === s.key ? null : s.key))} className={LINK} aria-expanded={picking === s.key} data-testid="section-change">
                      Change
                    </button>
                  ) : null}
                  {editing !== s.key ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(s.key);
                        setDraft(s.edited ?? s.text);
                      }}
                      className={LINK}
                      data-testid="section-edit"
                    >
                      Edit
                    </button>
                  ) : null}
                  {noting !== s.key ? (
                    <button type="button" onClick={() => openNote(s)} className={LINK} data-testid="section-note-open">
                      {s.note ? "Edit note" : "+ Note"}
                    </button>
                  ) : null}
                  {s.note && noting !== s.key ? (
                    <button type="button" onClick={() => saveNote(s.key, "")} className={LINK} data-testid="section-note-remove">
                      Remove note
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
            {picking === s.key && s.included ? <Picker s={s} onToggle={(id) => (s.pick ? toggleTop(s, id) : toggleItem(s, id))} onDone={() => setPicking(null)} /> : null}
            {/* 2026-11-06 (Bram): a note sits first, under the heading and above the section's items. */}
            {noting === s.key && s.included ? (
              <NoteBox key={s.key} title={s.title} value={noteDraft} onChange={setNoteDraft} onSave={() => saveNote(s.key, noteDraft)} onCancel={() => setNoting(null)} />
            ) : s.note ? (
              <div className={cn(!s.included && "opacity-[0.38]")} dangerouslySetInnerHTML={{ __html: noteHtml(s.note) }} data-testid="section-note" />
            ) : null}
            {editing === s.key && s.included ? (
              <div className="grid gap-2" data-testid="section-editor">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))} className="w-full rounded-[7px] border border-input bg-white px-2.5 py-2 text-[13px] leading-[1.5] text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Edit ${s.title}`} data-testid="section-edit-text" autoFocus />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => saveEdit(s)} className="inline-flex h-[30px] items-center rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[12.5px] font-medium text-white hover:bg-primary-solid-hover" data-testid="section-edit-save">
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="inline-flex h-[30px] items-center rounded-[7px] border border-input bg-white px-3 text-[12.5px] font-medium text-slate-800 hover:bg-slate-50">
                    Cancel
                  </button>
                  {s.edited ? (
                    <button type="button" onClick={() => backToAppText(s)} className="inline-flex h-[30px] items-center rounded-[7px] px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-slate-100" data-testid="section-edit-reset">
                      Use the app&apos;s text
                    </button>
                  ) : null}
                  <span className="text-[12px] text-muted-foreground">Start a line with &ldquo;- &rdquo; for a bullet; two spaces before it for a line under it.</span>
                </div>
              </div>
            ) : (
              <div className={cn(!s.included && "opacity-[0.38]")} dangerouslySetInnerHTML={{ __html: s.emptyAfterChange && !s.edited ? `<div style="font-size:12.5px;color:#64748b">Nothing shown in this section today. Press Change to show items again, or untick the section.</div>` : sectionBodyHtml(s) }} data-testid="section-body" />
            )}
          </div>
        ))}
        <div className="mt-3" dangerouslySetInnerHTML={{ __html: closingHtml(copy.report.signName) }} />
      </div>
    </>
  );
}

/** The "+ Note" box: a few lines (it grows to about 6, then scrolls), Save and Cancel. No AI star here. */
const NOTE_LINE = 19.5;
const NOTE_PAD = 16;
const NOTE_MIN_LINES = 3;
const NOTE_MAX_LINES = 6;

function NoteBox({ title, value, onChange, onSave, onCancel }: { title: string; value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, NOTE_MAX_LINES * NOTE_LINE + NOTE_PAD + 2)}px`;
  };
  return (
    <div className="mt-1.5 mb-2 grid gap-2" data-testid="section-note-box">
      <textarea
        ref={fit}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          fit(e.target);
        }}
        rows={NOTE_MIN_LINES}
        maxLength={NOTE_MAX}
        placeholder="Add a few lines for your partner: context, why it matters, what to watch"
        className="block w-full resize-none overflow-y-auto rounded-[7px] border border-input bg-white px-2.5 py-2 text-[13px] leading-[1.5] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ minHeight: NOTE_MIN_LINES * NOTE_LINE + NOTE_PAD + 2, maxHeight: NOTE_MAX_LINES * NOTE_LINE + NOTE_PAD + 2 }}
        aria-label={`Note under ${title}`}
        data-testid="section-note-text"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} className="inline-flex h-[30px] items-center rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[12.5px] font-medium text-white hover:bg-primary-solid-hover" data-testid="section-note-save">
          Save
        </button>
        <button type="button" onClick={onCancel} className="inline-flex h-[30px] items-center rounded-[7px] border border-input bg-white px-3 text-[12.5px] font-medium text-slate-800 hover:bg-slate-50" data-testid="section-note-cancel">
          Cancel
        </button>
        <span className="text-[12px] text-muted-foreground">Shows under this section in every copy that includes it. Today only.</span>
      </div>
    </div>
  );
}

/** Change: tick what a section shows today; for Top 3 deals, pick the 3 deals (a deal taken out goes to Active). */
function Picker({ s, onToggle, onDone }: { s: BuiltSection; onToggle: (id: string) => void; onDone: () => void }) {
  const top = !!s.pick;
  const list = top ? s.pick!.map((x) => ({ id: x.id, label: x.label, stage: x.stage, on: x.on })) : (s.choices ?? []).map((x) => ({ ...x, stage: null as string | null }));
  const shown = list.filter((x) => x.on).length;
  return (
    <div className="mb-3 rounded-[9px] border border-border bg-background px-3.5 py-2.5" data-testid="section-picker" data-section={s.key}>
      <div className="mb-1 flex justify-between gap-2 text-[12px] font-semibold text-heading">
        <span>{top ? `Pick the ${TOP_N} deals that lead the report · ${shown} of ${TOP_N} picked` : `Pick what ${s.title} shows today · ${shown} of ${list.length} shown`}</span>
        <button type="button" onClick={onDone} className={LINK} data-testid="picker-done">
          Done
        </button>
      </div>
      {list.map((x) => (
        <label key={x.id} className={cn("-mx-1 grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[5px] px-1 py-[5px] text-[13.5px] hover:bg-slate-100", x.on ? "font-medium text-primary-strong" : "text-slate-800")} data-testid="picker-option" data-id={x.id} data-on={x.on ? "1" : "0"}>
          <input type="checkbox" checked={x.on} disabled={top && !x.on && shown >= TOP_N} onChange={() => onToggle(x.id)} className="mt-[3px] h-4 w-4 accent-[var(--primary)]" />
          <span className="min-w-0">
            {x.label}
            {x.stage ? <span className="font-normal text-muted-foreground"> · {x.stage}</span> : null}
          </span>
          <span className="text-[12.5px] text-primary-strong">{top && x.on ? "in" : ""}</span>
        </label>
      ))}
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{top ? "A deal taken out of the top 3 goes to Active if it was worked on. Nothing repeats." : "Applies to today only. Edit rewrites the text instead."}</p>
    </div>
  );
}
