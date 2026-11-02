"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLead, createOpportunity, type LeadInput, type OpportunityInput } from "@/app/actions/pipelines";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { addDaysISO } from "@/lib/calc/dates";
import type { AskContext } from "@/lib/work/ask-ai";
import { AiFieldStar } from "@/components/app/work/ask-ai";
import { RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Add an opportunity (Job search) and Add a lead (Consulting), batch B2: one card above the columns (?add=1) with
 * the fields in two columns, the first next action with the purple star, Cancel and Save. Save opens the new
 * record's page.
 */
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";

function Field({ id, label, children, wide }: { id: string; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

const EMPTY_OPP: OpportunityInput = { company: "", role: "", contact: "", location: "", whatItDoes: "", source: "", link: "", payRange: "", nextAction: "", due: "", note: "" };

export function AddOpportunityCard({ today, onClose }: { today: string; onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [f, setF] = useState<OpportunityInput>({ ...EMPTY_OPP, due: addDaysISO(today, 3) });
  const [focused, setFocused] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = !!(f.company || f.role || f.contact || f.nextAction);
  useUnsavedWork(dirty, "The opportunity is not saved yet.");
  const set = (k: keyof OpportunityInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ask: AskContext = { page: "jobs", label: "Job search" };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createOpportunity(f);
      if (!r.ok) return setError(r.error);
      router.push(`/work/jobs/${r.id}`);
    });
  const text = (k: keyof OpportunityInput, label: string, placeholder = "", wide = false) => (
    <Field id={`${ids}-${k}`} label={label} wide={wide}>
      <input id={`${ids}-${k}`} value={String(f[k] ?? "")} onChange={set(k)} placeholder={placeholder} className={INPUT} data-testid={`opp-${k}`} />
    </Field>
  );
  return (
    <WorkCard title="Add an opportunity" hint="The company and the role are enough to start" testId="add-opportunity">
      <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 px-[22px] pt-3 pb-5 sm:grid-cols-2" data-testid="add-opportunity-form">
        {text("company", "Company", "Harbor Health Partners")}
        {text("role", "Role", "Director of Operations")}
        {text("contact", "Contact", "Nina Reyes, Korn Ferry")}
        {text("source", "Source", "Recruiter, personal network, a posting")}
        {text("location", "Location", "Charlotte, NC, on site")}
        {text("payRange", "Pay range", "$150K to $170K")}
        {text("whatItDoes", "What the company does", "Multi-site home health", true)}
        {text("link", "Link", "https://", true)}
        <Field id={`${ids}-nextAction`} label="First next action" wide>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <div className="relative min-w-0 flex-1 basis-[240px]">
              <input id={`${ids}-nextAction`} value={f.nextAction} onChange={set("nextAction")} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="Leave empty for the stage default: ask for an introduction or a first conversation" className={cn(INPUT, "pr-9")} data-testid="opp-nextAction" />
              <AiFieldStar context={ask} field={{ key: "next_action", label: "First next action", current: f.nextAction, extra: f.company ? `The opportunity: ${f.role || "a role"} at ${f.company}${f.contact ? `, contact ${f.contact}` : ""}.` : null }} visible={!f.nextAction.trim() || focused} onUse={(t) => setF((x) => ({ ...x, nextAction: t }))} />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={`${ids}-due`} className={LABEL}>
                Due
              </label>
              <input id={`${ids}-due`} type="date" value={f.due} onChange={set("due")} className={cn(INPUT, "w-auto")} data-testid="opp-due" />
            </div>
          </div>
        </Field>
        {text("note", "One-line note", "What you know so far", true)}
        <div className="flex flex-wrap items-center justify-end gap-2.5 sm:col-span-2">
          {error ? (
            <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="opp-error">
              {error}
            </span>
          ) : null}
          <RowButton onClick={onClose} disabled={pending}>
            Cancel
          </RowButton>
          <RowButton tone="primary" onClick={save} disabled={pending || !f.company.trim()} data-testid="opp-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </div>
      </div>
    </WorkCard>
  );
}

const EMPTY_LEAD: LeadInput = { client: "", project: "", contact: "", fee: "", scope: "", startDate: "", nextAction: "", due: "", note: "" };

export function AddLeadCard({ today, onClose }: { today: string; onClose: () => void }) {
  const ids = useId();
  const router = useRouter();
  const [f, setF] = useState<LeadInput>({ ...EMPTY_LEAD, due: addDaysISO(today, 3) });
  const [focused, setFocused] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = !!(f.client || f.project || f.contact || f.nextAction);
  useUnsavedWork(dirty, "The lead is not saved yet.");
  const set = (k: keyof LeadInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ask: AskContext = { page: "consulting", label: "Consulting" };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createLead(f);
      if (!r.ok) return setError(r.error);
      router.push(`/work/consulting/${r.id}`);
    });
  const text = (k: keyof LeadInput, label: string, placeholder = "", wide = false) => (
    <Field id={`${ids}-${k}`} label={label} wide={wide}>
      <input id={`${ids}-${k}`} value={String(f[k] ?? "")} onChange={set(k)} placeholder={placeholder} className={INPUT} data-testid={`lead-${k}`} />
    </Field>
  );
  return (
    <WorkCard title="Add a lead" hint="The client and the project are enough to start" testId="add-lead">
      <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 px-[22px] pt-3 pb-5 sm:grid-cols-2" data-testid="add-lead-form">
        {text("client", "Client", "Sullivan Wickley")}
        {text("project", "Project", "Q1 site selection")}
        {text("contact", "Contact", "Greg Thornton, Partner")}
        {text("fee", "Fee", "$18K")}
        {text("scope", "Scope", "Market screen, site visits, a comparison memo", true)}
        <Field id={`${ids}-startDate`} label="Start date">
          <input id={`${ids}-startDate`} type="date" value={f.startDate} onChange={set("startDate")} className={cn(INPUT, "w-auto")} data-testid="lead-startDate" />
        </Field>
        {text("note", "One-line note", "What you know so far")}
        <Field id={`${ids}-nextAction`} label="First next action" wide>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <div className="relative min-w-0 flex-1 basis-[240px]">
              <input id={`${ids}-nextAction`} value={f.nextAction} onChange={set("nextAction")} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="Leave empty for the stage default: find out what they need and who decides" className={cn(INPUT, "pr-9")} data-testid="lead-nextAction" />
              <AiFieldStar context={ask} field={{ key: "next_action", label: "First next action", current: f.nextAction, extra: f.client ? `The lead: ${f.project || "a project"} for ${f.client}${f.contact ? `, contact ${f.contact}` : ""}.` : null }} visible={!f.nextAction.trim() || focused} onUse={(t) => setF((x) => ({ ...x, nextAction: t }))} />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={`${ids}-due`} className={LABEL}>
                Due
              </label>
              <input id={`${ids}-due`} type="date" value={f.due} onChange={set("due")} className={cn(INPUT, "w-auto")} data-testid="lead-due" />
            </div>
          </div>
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2.5 sm:col-span-2">
          {error ? (
            <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="lead-error">
              {error}
            </span>
          ) : null}
          <RowButton onClick={onClose} disabled={pending}>
            Cancel
          </RowButton>
          <RowButton tone="primary" onClick={save} disabled={pending || !f.client.trim()} data-testid="lead-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        </div>
      </div>
    </WorkCard>
  );
}
