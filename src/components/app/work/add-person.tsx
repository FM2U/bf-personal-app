"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPerson, savePersonFacts, type PersonInput } from "@/app/actions/outreach";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { OUTREACH_ROLES, PURPOSES, purposesText } from "@/lib/work/outreach";
import { RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";

/**
 * The Purpose field (approved 2026-10-31, decisions on v2): a field like the others that opens a short checklist;
 * the chosen values show in the field as text ("Off-market deals, Rosara"). No pill row.
 */
export function PurposeField({ id, value, onChange, testId = "purpose-field" }: { id: string; value: string[]; onChange: (v: string[]) => void; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div ref={ref} className="relative min-w-0" data-testid={testId} data-value={value.join(",")}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(INPUT, "flex items-center justify-between gap-2 text-left", !value.length && "text-slate-400")}
        data-testid="purpose-toggle"
      >
        <span className="truncate">{purposesText(value) || "Pick one or more"}</span>
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0 text-slate-400" aria-hidden>
          <path d="M1 3h8L5 7.5z" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+4px)] left-0 z-20 flex w-full min-w-[200px] flex-col rounded-[8px] border border-border bg-white p-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.12)]" role="listbox" data-testid="purpose-menu">
          {PURPOSES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
              <input type="checkbox" checked={value.includes(p.key)} onChange={() => toggle(p.key)} className="h-4 w-4 accent-[var(--primary)]" data-testid={`purpose-${p.key}`} />
              {p.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const EMPTY: PersonInput = { name: "", organization: "", role: "broker", purposes: [], email: "", phone: "", linkedin: "", nextFollowUp: "", note: "" };

/** The fields shared by Add a person and the Facts card: label on the left, field on the right, two columns on wide screens. */
export function PersonFields({ f, set, ids, withFollowUp = true, withTitle = false }: { f: PersonInput; set: (k: keyof PersonInput, v: string | string[]) => void; ids: string; withFollowUp?: boolean; withTitle?: boolean }) {
  const field = (k: keyof PersonInput, label: string, node: React.ReactNode) => (
    <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[104px_minmax(0,1fr)]" key={k}>
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      {node}
    </div>
  );
  const text = (k: keyof PersonInput, label: string, placeholder: string, type = "text") => field(k, label, <input id={`${ids}-${k}`} type={type} value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={INPUT} data-testid={`person-${k}`} />);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2" data-testid="person-fields">
      {text("name", "Name", "First and last name")}
      {text("organization", "Organization", "Company or firm")}
      {field(
        "role",
        "Role",
        <select id={`${ids}-role`} value={f.role} onChange={(e) => set("role", e.target.value)} className={INPUT} data-testid="person-role">
          {OUTREACH_ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>,
      )}
      {text("email", "Email", "name@company.com", "email")}
      {field("purposes", "Purpose", <PurposeField id={`${ids}-purposes`} value={f.purposes} onChange={(v) => set("purposes", v)} />)}
      {text("phone", "Phone", "(404) 555-0100")}
      {text("linkedin", "LinkedIn", "linkedin.com/in/...")}
      {withFollowUp ? text("nextFollowUp", "Next follow-up", "", "date") : withTitle ? text("title", "Title", "COO, Partner, Broker, East Tennessee") : null}
      <div className="md:col-span-2">{text("note", "One-line note", "Why you keep in touch")}</div>
    </div>
  );
}

/** Add a person (the card under the Outreach filters): Name, role, and purpose are enough to start. */
export function AddPersonCard({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [f, setF] = useState<PersonInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  useUnsavedWork(dirty, "The person is not saved yet.");
  const set = (k: keyof PersonInput, v: string | string[]) => setF((x) => ({ ...x, [k]: v }));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createPerson(f);
      if (!r.ok) return setError(r.error);
      setF(EMPTY);
      onClose();
      router.push(`/work/outreach?saved=${encodeURIComponent(f.name.trim())}`);
      router.refresh();
    });
  return (
    <WorkCard title="Add a person" hint="Name, role, and purpose are enough to start" testId="add-person">
      <div className="flex flex-col gap-3 px-[22px] pt-3 pb-4">
        <PersonFields f={f} set={set} ids={ids} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="person-error">
              {error}
            </span>
          ) : null}
          <RowButton onClick={onClose} disabled={pending} className="h-9 px-3.5 text-[13px]">
            Cancel
          </RowButton>
          <RowButton tone="primary" onClick={save} disabled={pending || !f.name.trim()} className="h-9 px-3.5 text-[13px]" data-testid="person-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </div>
        <p className="text-[12.5px] text-muted-foreground">People here are the app&apos;s contact records. Outreach is the working view of them.</p>
      </div>
    </WorkCard>
  );
}

/** The Facts card's edit form on the person page (the same fields, without the next follow-up, with the title). */
export function PersonFactsForm({ personId, initial, onSaved, onCancel }: { personId: string; initial: PersonInput; onSaved: () => void; onCancel: () => void }) {
  const ids = useId();
  const [f, setF] = useState<PersonInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useUnsavedWork(dirty, "The facts are not saved yet.");
  const set = (k: keyof PersonInput, v: string | string[]) => setF((x) => ({ ...x, [k]: v }));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await savePersonFacts(personId, f);
      if (!r.ok) return setError(r.error);
      onSaved();
    });
  return (
    <div className="flex flex-col gap-3 px-[22px] pt-3 pb-4" data-testid="person-facts-form">
      <PersonFields f={f} set={set} ids={ids} withFollowUp={false} withTitle />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="person-error">
            {error}
          </span>
        ) : null}
        <RowButton onClick={onCancel} disabled={pending}>
          Cancel
        </RowButton>
        <RowButton tone="primary" onClick={save} disabled={pending || !dirty} data-testid="person-facts-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
    </div>
  );
}
