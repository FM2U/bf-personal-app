"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, X } from "lucide-react";
import { previewSendReport, sendReport, sendReportSetup, type SendReportSetup, type SendReportTo } from "@/app/actions/send-report";
import { CenteredWindow } from "@/components/app/window";
import { Confirm } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Send a report (Bram, 2026-11-07; claude/2026-11-07-part-b-fix-list.md, design A). The button on End of day (report
 * card) and on Reports (top). The window: 1. which report (today, or an earlier sent day); 2. to whom (partners, any
 * contact with an email address, or a new address, saved as a contact unless unticked); 3. which sections (all ticked);
 * a short note of your own under the greeting; the preview as the first person chosen gets it; then Send.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const BOX = "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-primary-strong";
const STEP = "label-caps figure-label mb-2 block";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

type Fresh = { key: string; email: string; name: string; save: boolean };

export function SendReportButton({ className, testId = "send-a-report", label = "Send a report" }: { className?: string; testId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className} data-testid={testId}>
        {label}
      </button>
      {open ? <SendReportWindow onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SendReportWindow({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SendReportSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<string>("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [fresh, setFresh] = useState<Fresh[]>([]);
  const [search, setSearch] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newSave, setNewSave] = useState(true);
  const [newError, setNewError] = useState<string | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [intro, setIntro] = useState("");
  const [preview, setPreview] = useState<{ html: string; subject: string; asSent: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owedAsk, setOwedAsk] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string[]; marked: boolean } | null>(null);
  const [sending, startSend] = useTransition();
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let live = true;
    sendReportSetup().then((r) => {
      if (!live) return;
      if (!r.ok) return setLoadError(r.error);
      setSetup(r);
      setDay(r.today);
      setSections(r.sections.map((s) => s.key));
    });
    return () => {
      live = false;
    };
  }, []);

  const people = useMemo(() => setup?.people ?? [], [setup]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const partners = people.filter((p) => p.partner);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => !p.partner && !chosen.includes(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.org ?? "").toLowerCase().includes(q))).slice(0, 8);
  }, [people, search, chosen]);
  const firstName = chosen.length ? (byId.get(chosen[0])?.name ?? "") : (fresh[0]?.name ?? "");
  const count = chosen.length + fresh.length;

  // The preview follows the choices (a short pause after typing in the note).
  useEffect(() => {
    if (!setup || !day) return;
    if (!sections.length) {
      setPreview(null);
      setPreviewError("Tick at least one section.");
      return;
    }
    let live = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      previewSendReport({ day, sections, intro, name: firstName }).then((r) => {
        if (!live) return;
        setPreviewing(false);
        if (!r.ok) {
          setPreview(null);
          return setPreviewError(r.error);
        }
        setPreviewError(null);
        setPreview({ html: r.html, subject: r.subject, asSent: r.asSent });
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [setup, day, sections, intro, firstName]);

  const toggle = (id: string, on: boolean) => setChosen((c) => (on ? (c.includes(id) ? c : [...c, id]) : c.filter((x) => x !== id)));
  const addNew = () => {
    const email = newEmail.trim();
    if (!EMAIL.test(email)) return setNewError("Type a full email address, like name@example.com.");
    const known = people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (known) {
      toggle(known.id, true);
    } else if (!fresh.some((f) => f.email.toLowerCase() === email.toLowerCase())) {
      setFresh((f) => [...f, { key: newRequestId(), email, name: newName.trim(), save: newSave }]);
    }
    setNewEmail("");
    setNewName("");
    setNewSave(true);
    setNewError(null);
  };

  const send = (force = false) =>
    startSend(async () => {
      setError(null);
      setOwedAsk(null);
      const to: SendReportTo[] = [...chosen.map((contactId) => ({ contactId })), ...fresh.map((f) => ({ email: f.email, name: f.name, save: f.save }))];
      const r = await sendReport({ day, sections, intro, to, requestId: requestId.current, force });
      if (!r.ok) {
        if (r.owed) return setOwedAsk(r.error);
        setError(r.error);
        if (r.sentTo?.length) router.refresh();
        return;
      }
      setSent({ to: r.sentTo, marked: r.dayMarkedSent });
      router.refresh();
    });

  const dayInfo = setup?.days.find((d) => d.day === day) ?? null;
  const footer = sent ? (
    <div className="flex w-full items-center justify-end">
      <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-[7px] border border-input bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" data-testid="send-report-close">
        Close
      </button>
    </div>
  ) : (
    <div className="flex w-full flex-wrap items-center justify-end gap-2.5">
      <span className="mr-auto text-[12.5px] text-muted-foreground" data-testid="send-report-count">
        {count ? `${count} ${count === 1 ? "person" : "people"} chosen` : "Nobody chosen yet"}
      </span>
      <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-[7px] border border-input bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Cancel
      </button>
      <button type="button" onClick={() => send(false)} disabled={sending || !count || !sections.length || !setup} className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-primary-solid bg-primary-solid px-4 text-sm font-medium text-white hover:bg-primary-solid-hover disabled:pointer-events-none disabled:opacity-50" data-testid="send-report-send" data-busy={sending ? "1" : "0"}>
        {sending ? <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden /> : <Send className="h-[14px] w-[14px]" aria-hidden />}
        {sending ? "Sending…" : count > 1 ? `Send to ${count} people` : "Send"}
      </button>
    </div>
  );

  return (
    <CenteredWindow open onOpenChange={(o) => (o ? null : onClose())} title="Send a report" sub="Today's report or an earlier one, to anyone with an email address. Partners' usual days do not change." size="report" testId="send-report-window" footer={footer}>
      {loadError ? (
        <Confirm tone="warn" testId="send-report-error">
          {loadError}
        </Confirm>
      ) : !setup ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading your reports and contacts…
        </p>
      ) : sent ? (
        <Confirm tone="ok" testId="send-report-sent">
          Sent through Gmail to {sent.to.join(", ")}.{sent.marked ? " Today counts as sent on End of day." : ""} It shows on {sent.to.length > 1 ? "each person's" : "the person's"} timeline, and replies show on Reports.
        </Confirm>
      ) : (
        <div className="flex flex-col gap-6">
          <section data-testid="send-report-day">
            <label className={STEP} htmlFor="send-report-day">
              1. Which report
            </label>
            <select id="send-report-day" value={day} onChange={(e) => setDay(e.target.value)} className={cn(INPUT, "max-w-[320px]")} data-testid="send-report-day-select">
              {setup.days.map((d) => (
                <option key={d.day} value={d.day}>
                  {d.label}
                  {d.today ? " (as it stands now)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">{dayInfo?.today ? "Sending today's report here counts today as sent, as Approve and send does." : "Sending an earlier report again changes nothing about that day."}</p>
          </section>

          <section data-testid="send-report-to">
            <span className={STEP}>2. To whom</span>
            {partners.length ? (
              <div className="mb-3 flex flex-col gap-1.5">
                {partners.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-slate-900" data-testid="send-report-partner">
                    <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} className={BOX} />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[12.5px] text-muted-foreground">partner · {p.email}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {chosen.filter((id) => !byId.get(id)?.partner).length || fresh.length ? (
              <div className="mb-3 flex flex-wrap gap-1.5" data-testid="send-report-chosen">
                {chosen
                  .filter((id) => !byId.get(id)?.partner)
                  .map((id) => {
                    const p = byId.get(id);
                    return p ? <Chip key={id} text={p.name} sub={p.email} onRemove={() => toggle(id, false)} /> : null;
                  })}
                {fresh.map((f) => (
                  <Chip key={f.key} text={f.name || f.email} sub={f.name ? `${f.email}${f.save ? " · new contact" : ""}` : f.save ? "new contact" : "not saved"} onRemove={() => setFresh((x) => x.filter((y) => y.key !== f.key))} />
                ))}
              </div>
            ) : null}
            <div className="relative max-w-[420px]">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your contacts by name, email or organization" className={INPUT} data-testid="send-report-search" aria-label="Search your contacts" />
              {matches.length ? (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-10 rounded-[8px] border border-rule bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]" data-testid="send-report-matches">
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        toggle(p.id, true);
                        setSearch("");
                      }}
                      className="row-hover block w-full px-3 py-1.5 text-left"
                      data-testid="send-report-match"
                    >
                      <span className="block text-[13.5px] font-medium text-slate-900">{p.name}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {p.email}
                        {p.org ? ` · ${p.org}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : search.trim() ? (
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">No contact with an email address matches. Add the address below.</p>
              ) : null}
            </div>
            <div className="mt-3 grid max-w-[620px] grid-cols-1 gap-2 min-[561px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), addNew()) : null)} placeholder="New email address" className={INPUT} data-testid="send-report-new-email" aria-label="New email address" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), addNew()) : null)} placeholder="Their name (optional)" className={INPUT} data-testid="send-report-new-name" aria-label="Their name" />
              <button type="button" onClick={addNew} disabled={!newEmail.trim()} className="inline-flex h-9 items-center justify-center rounded-[7px] border border-primary-strong bg-white px-3.5 text-[13px] font-medium text-primary-strong hover:bg-primary-soft disabled:pointer-events-none disabled:opacity-50" data-testid="send-report-new-add">
                Add
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-[13px] text-slate-700">
              <input type="checkbox" checked={newSave} onChange={(e) => setNewSave(e.target.checked)} className={BOX} data-testid="send-report-new-save" />
              Save a new address as a contact (untick to send only)
            </label>
            {newError ? <p className="mt-1.5 text-[12.5px] text-status-missed">{newError}</p> : null}
          </section>

          <section data-testid="send-report-sections">
            <span className={STEP}>3. Which sections</span>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 min-[561px]:grid-cols-2">
              {setup.sections.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-slate-900" data-testid="send-report-section" data-key={s.key}>
                  <input type="checkbox" checked={sections.includes(s.key)} onChange={(e) => setSections((x) => (e.target.checked ? setup.sections.map((y) => y.key).filter((k) => k === s.key || x.includes(k)) : x.filter((k) => k !== s.key)))} className={cn(BOX, "mt-[2px]")} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
            {preview?.asSent ? <p className="mt-1.5 text-[12.5px] text-muted-foreground">This day was kept only as the email that went out, so it is sent with the sections it had then.</p> : null}
          </section>

          <section>
            <label className={STEP} htmlFor="send-report-intro">
              Your note (optional)
            </label>
            <textarea id="send-report-intro" value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} maxLength={1200} placeholder="A few words under the greeting, for example who you are and why you are sending this." className={cn(INPUT, "h-auto py-2 leading-[1.45]")} data-testid="send-report-intro" />
          </section>

          <section data-testid="send-report-preview-box">
            <span className={STEP}>Preview{firstName ? `, as ${firstName.split(/\s+/)[0]} gets it` : ""}</span>
            {preview ? <p className="mb-2 text-[13px] text-slate-700">Subject: {preview.subject}</p> : null}
            <div className={cn("rounded-[10px] border border-rule bg-slate-50 px-3 py-3 transition-opacity", previewing && "opacity-60")}>
              {previewError ? (
                <p className="text-[13px] text-status-missed">{previewError}</p>
              ) : preview ? (
                <div className="report-preview report-window report-sent min-w-0 overflow-x-auto text-[13px] text-slate-900" dangerouslySetInnerHTML={{ __html: preview.html }} data-testid="send-report-preview" />
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Building the preview…
                </p>
              )}
            </div>
          </section>

          {owedAsk ? (
            <Confirm tone="warn" testId="send-report-owed">
              <span className="min-w-0 flex-1">{owedAsk}</span>
              <button type="button" onClick={() => send(true)} disabled={sending} className="font-medium text-primary-strong hover:underline" data-testid="send-report-anyway">
                Send anyway
              </button>
            </Confirm>
          ) : null}
          {error ? (
            <Confirm tone="warn" testId="send-report-error">
              {error}
            </Confirm>
          ) : null}
        </div>
      )}
    </CenteredWindow>
  );
}

function Chip({ text, sub, onRemove }: { text: string; sub: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary-border bg-primary-soft py-[3px] pr-1.5 pl-3 text-[12.5px] text-slate-800" data-testid="send-report-chip">
      <span className="min-w-0 truncate">
        <span className="font-medium">{text}</span>
        <span className="text-muted-foreground"> · {sub}</span>
      </span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${text}`} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-status-missed">
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
