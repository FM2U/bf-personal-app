"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { SendReportPerson, SendReportTo } from "@/app/actions/send-report";

/**
 * Who gets a report (one report window, Bram 2026-11-08): partners, any contact with an email address, or a new
 * address (saved as a contact unless unticked). Used by End of day's report window, under "Also send to" for today and
 * under "Send to" for an earlier day (src/components/app/work/end-of-day-board.tsx).
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const BOX = "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] accent-primary-strong";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export type FreshAddress = { key: string; email: string; name: string; save: boolean };
export type Recipients = { chosen: string[]; fresh: FreshAddress[] };
export const NO_RECIPIENTS: Recipients = { chosen: [], fresh: [] };

export function recipientsTo(r: Recipients): SendReportTo[] {
  return [...r.chosen.map((contactId) => ({ contactId })), ...r.fresh.map((f) => ({ email: f.email, name: f.name, save: f.save }))];
}

export const recipientCount = (r: Recipients) => r.chosen.length + r.fresh.length;

/**
 * Who gets a report: partners as tick boxes (unless `partners` is false), the people found by search as chips, and a
 * new address with an optional name ("Save a new address as a contact", ticked to start). Shared by Send a report and
 * End of day's "Also send to" (Bram, 2026-11-08).
 */
export function RecipientPicker({ people, value, onChange, partners = true, exclude = [], testId = "send-report-to" }: { people: SendReportPerson[]; value: Recipients; onChange: (r: Recipients) => void; partners?: boolean; exclude?: readonly string[]; testId?: string }) {
  const [search, setSearch] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newSave, setNewSave] = useState(true);
  const [newError, setNewError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const shownPartners = partners ? people.filter((p) => p.partner && !exclude.includes(p.id)) : [];
  const chipIds = value.chosen.filter((id) => !shownPartners.some((p) => p.id === id));
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => !(partners && p.partner) && !exclude.includes(p.id) && !value.chosen.includes(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.org ?? "").toLowerCase().includes(q))).slice(0, 8);
  }, [people, search, value.chosen, partners, exclude]);
  const toggle = (id: string, on: boolean) => onChange({ ...value, chosen: on ? (value.chosen.includes(id) ? value.chosen : [...value.chosen, id]) : value.chosen.filter((x) => x !== id) });
  const addNew = () => {
    const email = newEmail.trim();
    if (!EMAIL.test(email)) return setNewError("Type a full email address, like name@example.com.");
    const known = people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (known && exclude.includes(known.id)) return setNewError(`${known.name} is already on this report.`);
    if (known) toggle(known.id, true);
    else if (!value.fresh.some((f) => f.email.toLowerCase() === email.toLowerCase())) onChange({ ...value, fresh: [...value.fresh, { key: newRequestId(), email, name: newName.trim(), save: newSave }] });
    setNewEmail("");
    setNewName("");
    setNewSave(true);
    setNewError(null);
  };
  return (
    <div data-testid={testId}>
      {shownPartners.length ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {shownPartners.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-slate-900" data-testid="send-report-partner">
              <input type="checkbox" checked={value.chosen.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} className={BOX} />
              <span className="font-medium">{p.name}</span>
              <span className="text-[12.5px] text-muted-foreground">partner · {p.email}</span>
            </label>
          ))}
        </div>
      ) : null}
      {chipIds.length || value.fresh.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5" data-testid="send-report-chosen">
          {chipIds.map((id) => {
            const p = byId.get(id);
            return p ? <Chip key={id} text={p.name} sub={p.email} onRemove={() => toggle(id, false)} /> : null;
          })}
          {value.fresh.map((f) => (
            <Chip key={f.key} text={f.name || f.email} sub={f.name ? `${f.email}${f.save ? " · new contact" : ""}` : f.save ? "new contact" : "not saved"} onRemove={() => onChange({ ...value, fresh: value.fresh.filter((y) => y.key !== f.key) })} />
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
    </div>
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
