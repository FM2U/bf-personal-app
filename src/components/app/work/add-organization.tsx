"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrganization, saveOrganizationFacts, type OrgInput } from "@/app/actions/organizations";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { ORG_KINDS, organizationHref } from "@/lib/work/people";
import { RowButton, WorkCard } from "@/components/app/work/ui";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";

export const EMPTY_ORG: OrgInput = { name: "", kind: "broker", region: "", website: "", phone: "", dealSize: "", note: "" };

/** The fields shared by Add an organization and the Facts card: label on the left (fixed width), two columns on wide screens. */
function OrgFields({ f, set, ids }: { f: OrgInput; set: (k: keyof OrgInput, v: string) => void; ids: string }) {
  const field = (k: keyof OrgInput, label: string, node: React.ReactNode, wide = false) => (
    <div className={`grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[104px_minmax(0,1fr)] ${wide ? "md:col-span-2" : ""}`} key={k}>
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      {node}
    </div>
  );
  const text = (k: keyof OrgInput, label: string, placeholder: string, wide = false) => field(k, label, <input id={`${ids}-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={INPUT} data-testid={`org-${k}`} />, wide);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2" data-testid="org-fields">
      {text("name", "Name", "Firm or company")}
      {field(
        "kind",
        "Kind",
        <select id={`${ids}-kind`} value={f.kind} onChange={(e) => set("kind", e.target.value)} className={INPUT} data-testid="org-kind">
          {ORG_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>,
      )}
      {text("region", "Region", "Knoxville and Chattanooga, TN")}
      {text("dealSize", "Deal size", "$1M to $8M revenue")}
      {text("website", "Website", "example.com")}
      {text("phone", "Phone", "(404) 555-0100")}
      {text("note", "One-line note", "What the firm does, in a few words", true)}
    </div>
  );
}

/** Add an organization (the card under the People filters on Organizations): a name is enough to start. */
export function AddOrganizationCard({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [f, setF] = useState<OrgInput>(EMPTY_ORG);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_ORG);
  useUnsavedWork(dirty, "The organization is not saved yet.");
  const set = (k: keyof OrgInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createOrganization(f);
      if (!r.ok) return setError(r.error);
      setF(EMPTY_ORG);
      router.push(organizationHref(r.id));
    });
  return (
    <WorkCard title="Add an organization" hint="A name is enough to start" testId="add-org">
      <div className="flex flex-col gap-3 px-[22px] pt-3 pb-4">
        <OrgFields f={f} set={set} ids={ids} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="org-error">
              {error}
            </span>
          ) : null}
          <RowButton onClick={onClose} disabled={pending} className="h-9 px-3.5 text-[13px]">
            Cancel
          </RowButton>
          <RowButton tone="primary" onClick={save} disabled={pending || !f.name.trim()} className="h-9 px-3.5 text-[13px]" data-testid="org-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </div>
        <p className="text-[12.5px] text-muted-foreground">A deal&apos;s company stays on the deal. Organizations are the firms you work with: brokers, lenders, employers, clients, investors.</p>
      </div>
    </WorkCard>
  );
}

/** The Facts card's edit form on the organization page. */
export function OrgFactsForm({ orgId, initial, onSaved, onCancel }: { orgId: string; initial: OrgInput; onSaved: () => void; onCancel: () => void }) {
  const ids = useId();
  const [f, setF] = useState<OrgInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useUnsavedWork(dirty, "The facts are not saved yet.");
  const set = (k: keyof OrgInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveOrganizationFacts(orgId, f);
      if (!r.ok) return setError(r.error);
      onSaved();
    });
  return (
    <div className="flex flex-col gap-3 px-[22px] pt-3 pb-4" data-testid="org-facts-form">
      <OrgFields f={f} set={set} ids={ids} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="org-error">
            {error}
          </span>
        ) : null}
        <RowButton onClick={onCancel} disabled={pending}>
          Cancel
        </RowButton>
        <RowButton tone="primary" onClick={save} disabled={pending || !dirty} data-testid="org-facts-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
    </div>
  );
}
