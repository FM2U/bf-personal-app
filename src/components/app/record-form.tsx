"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { createRecordInline, saveRecord, type FormState } from "@/app/actions/records";
import { DEAL_SOURCE_OPTIONS, getResource, type Field } from "@/lib/resources";
import { suggestDealSourceType } from "@/lib/calc/source-chain";
import type { FieldText } from "@/lib/pipeline-labels";
import { addCreatedOption, canQuickCreate, filterOptions, quickCreateFields, type RefOption } from "@/lib/quick-create";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Notice } from "@/components/app/page-header";
import { GuardedForm } from "@/components/app/unsaved-changes";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";

type RefOptions = Record<string, RefOption[]>;

/** Options for reference fields, shared by the form and its "+ New" dialogs. */
type RefCtx = { options: RefOptions; add: (table: string, option: RefOption) => void; allowCreate: boolean };
const RefContext = createContext<RefCtx>({ options: {}, add: () => {}, allowCreate: false });

function toInputValue(field: Field, v: unknown): string {
  if (v === null || v === undefined) return field.default !== undefined && typeof field.default !== "boolean" ? String(field.default) : "";
  if (field.type === "datetime" && typeof v === "string") return v.slice(0, 16);
  if (field.type === "json") return typeof v === "string" ? v : JSON.stringify(v);
  return String(v);
}

function FieldInput({ field, value, idPrefix = "f_" }: { field: Field; value: unknown; idPrefix?: string }) {
  const common = { id: `${idPrefix}${field.name}`, name: field.name, required: field.required && field.type !== "boolean" };
  switch (field.type) {
    case "textarea":
      return <Textarea {...common} defaultValue={toInputValue(field, value)} rows={3} />;
    case "number":
    case "money":
    case "percent":
      return <Input {...common} type="number" step="any" inputMode="decimal" defaultValue={toInputValue(field, value)} />;
    case "date":
      return <Input {...common} type="date" defaultValue={toInputValue(field, value)} />;
    case "datetime":
      return <Input {...common} type="datetime-local" defaultValue={toInputValue(field, value)} />;
    case "email":
      return <Input {...common} type="email" defaultValue={toInputValue(field, value)} />;
    case "url":
      return <Input {...common} type="url" defaultValue={toInputValue(field, value)} />;
    case "boolean": {
      const checked = value === null || value === undefined ? field.default === true : Boolean(value);
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" id={common.id} name={field.name} defaultChecked={checked} className="h-4 w-4 accent-teal-700" />
          Yes
        </label>
      );
    }
    case "select":
      return (
        <NativeSelect {...common} defaultValue={toInputValue(field, value)}>
          {!field.required || value === null || value === undefined ? <option value="">Choose</option> : null}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    case "ref":
      return <RefPicker field={field} id={common.id} initial={value === null || value === undefined ? "" : String(value)} />;
    case "multiselect": {
      const initial = Array.isArray(value) ? (value as unknown[]) : value === null || value === undefined ? String(field.default ?? "").split(",").filter(Boolean) : [];
      const selected = new Set(initial.map(String));
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-input bg-background px-3 py-2">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={field.name} value={o.value} defaultChecked={selected.has(o.value)} className="h-4 w-4 accent-teal-700" />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "tags":
      return <Input {...common} defaultValue={Array.isArray(value) ? (value as string[]).join(", ") : ""} placeholder="Separate with commas" />;
    case "actions":
      return <ActionsEditor name={field.name} initial={Array.isArray(value) ? (value as Row[]) : []} />;
    case "json":
      return <Input {...common} defaultValue={toInputValue(field, value)} placeholder="{}" className="font-mono text-xs" />;
    default:
      return <Input {...common} type="text" defaultValue={toInputValue(field, value)} />;
  }
}

/**
 * Searchable picker for a reference field: type to filter the list, then choose.
 * "+ New" opens a short form for the referenced record type; the new record is selected here.
 */
function RefPicker({ field, id, initial }: { field: Field; id: string; initial: string }) {
  const ctx = useContext(RefContext);
  // A field with refSubset lists only that subset (example: consulting items), loaded as "<table>:<subset>".
  const optionsKey = field.refSubset ? `${field.ref}:${field.refSubset}` : field.ref!;
  const options = useMemo(() => ctx.options[optionsKey] ?? ctx.options[field.ref!] ?? [], [ctx.options, optionsKey, field.ref]);
  const [selected, setSelected] = useState(initial);
  const labelOf = (v: string) => options.find((o) => o.id === v)?.label ?? "";
  const [text, setText] = useState(() => labelOf(initial));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const listId = useId();
  const changed = useRef(false);

  const query = text === labelOf(selected) ? "" : text;
  const shown = filterOptions(options, query);
  const items: (RefOption | null)[] = [...(field.required ? [] : [null]), ...shown];

  // Tell the unsaved changes warning that the value changed (a hidden field gets no typing events).
  useEffect(() => {
    if (!changed.current) return;
    hidden.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [selected]);

  const choose = (o: RefOption | null) => {
    changed.current = true;
    setSelected(o?.id ?? "");
    setText(o?.label ?? "");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (items[active] !== undefined) choose(items[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setText(labelOf(selected));
    }
  };

  const canCreate = ctx.allowCreate && !field.refSubset && canQuickCreate(field.ref);
  const singular = getResource(field.ref!)?.singular.toLowerCase() ?? "record";

  return (
    <div className="flex min-w-0 gap-2">
      <div className="relative min-w-0 flex-1">
        <input ref={hidden} type="hidden" name={field.name} value={selected} data-initial={initial} />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          required={field.required}
          value={text}
          placeholder={options.length ? "Type to search" : "None added yet"}
          className="pr-9"
          onFocus={(e) => {
            e.currentTarget.select();
            setOpen(true);
            setActive(Math.max(0, items.findIndex((o) => (o?.id ?? "") === selected)));
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(field.required ? 0 : 1);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            setOpen(false);
            if (!text.trim() && !field.required) {
              if (selected) choose(null);
            } else setText(labelOf(selected));
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        {open ? (
          <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-white py-1 text-sm shadow-lg">
            {items.map((o, i) => (
              <li
                key={o?.id ?? "__none"}
                role="option"
                aria-selected={(o?.id ?? "") === selected}
                className={cn(
                  "clamp-2 cursor-pointer px-3 py-1.5",
                  i === active && "bg-teal-50 text-teal-900",
                  !o && "text-muted-foreground",
                  (o?.id ?? "") === selected && "font-medium",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o ? o.label : "None"}
              </li>
            ))}
            {!shown.length ? <li className="px-3 py-1.5 text-muted-foreground">{query ? `No match for "${query}".` : "None added yet."}{canCreate ? " Use + New to add one." : ""}</li> : null}
          </ul>
        ) : null}
      </div>
      {canCreate ? (
        <Button type="button" variant="outline" className="shrink-0 px-3" onClick={() => setCreating(true)} aria-label={`New ${singular} for ${field.label}`}>
          <Plus /> New
        </Button>
      ) : null}
      {canCreate ? (
        <QuickCreateDialog
          table={field.ref!}
          open={creating}
          onOpenChange={setCreating}
          prefill={query}
          onCreated={(o) => {
            ctx.add(field.ref!, o);
            choose(o);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Short form for a new referenced record. Saving creates it, closes the dialog, and selects it in the field. */
function QuickCreateDialog({
  table,
  open,
  onOpenChange,
  prefill,
  onCreated,
}: {
  table: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: string;
  onCreated: (o: RefOption) => void;
}) {
  const r = getResource(table)!;
  const ctx = useContext(RefContext);
  const fields = quickCreateFields(table);
  const [error, setError] = useState<string | null>(null);
  const idPrefix = `q_${table}_`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md" aria-describedby={`${idPrefix}desc`}>
        <DialogTitle>New {r.singular.toLowerCase()}</DialogTitle>
        <DialogDescription id={`${idPrefix}desc`}>Saved now and chosen in the form. The rest of the form keeps what you typed.</DialogDescription>
        {open ? (
          <RefContext.Provider value={{ ...ctx, allowCreate: false }}>
            <GuardedForm
              action={createRecordInline}
              data-unsaved="off"
              data-quick-create={table}
              className="flex flex-col"
              onResult={(res) => {
                const out = res as Awaited<ReturnType<typeof createRecordInline>>;
                if (out?.ok) onCreated({ id: out.id, label: out.label });
                else setError(out?.error ?? "The record was not saved.");
              }}
            >
              <input type="hidden" name="__table" value={table} />
              {error ? (
                <div className="mb-3">
                  <Notice tone="error">{error}</Notice>
                </div>
              ) : null}
              <FieldGrid cols={1}>
                {fields.map((f) => (
                  <FormField key={f.name} label={f.label} htmlFor={`${idPrefix}${f.name}`} required={f.required} wide={f.type === "textarea"}>
                    <input type="hidden" name={`${f.name}__present`} value="1" />
                    <FieldInput field={f} value={f.name === r.titleField && prefill ? prefill : undefined} idPrefix={idPrefix} />
                  </FormField>
                ))}
              </FieldGrid>
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Add {r.singular.toLowerCase()}</SubmitButton>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </div>
            </GuardedForm>
          </RefContext.Provider>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type ActionDraft = { type: "create_task" | "create_alert" | "open_decision"; title?: string; message?: string; options?: string[] };

function cleanActions(actions: ActionDraft[]) {
  return actions
    .map((a) =>
      a.type === "create_task"
        ? { type: a.type, title: a.title ?? "" }
        : a.type === "create_alert"
          ? { type: a.type, message: a.message ?? "" }
          : { type: a.type, title: a.title ?? "", options: (a.options ?? []).filter(Boolean) },
    )
    .filter((a) => ("title" in a ? a.title : a.message));
}

/** Builds the list of required actions for a decision condition. */
export function ActionsEditor({ name, initial }: { name: string; initial: Row[] }) {
  const [actions, setActions] = useState<ActionDraft[]>(initial.length ? (initial as ActionDraft[]) : [{ type: "create_task", title: "" }]);
  const [initialJson] = useState(() => JSON.stringify(cleanActions(initial as ActionDraft[])));
  const update = (i: number, patch: Partial<ActionDraft>) => setActions((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const clean = cleanActions(actions);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-input bg-background p-3">
      <input type="hidden" name={name} value={JSON.stringify(clean)} data-initial={initialJson} />
      {actions.map((a, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[12rem_1fr_auto]">
          <NativeSelect value={a.type} onChange={(e) => update(i, { type: e.target.value as ActionDraft["type"] })} aria-label="Action">
            <option value="create_task">Create a task</option>
            <option value="create_alert">Add an alert to Home</option>
            <option value="open_decision">Open a decision record</option>
          </NativeSelect>
          {a.type === "create_alert" ? (
            <Input value={a.message ?? ""} onChange={(e) => update(i, { message: e.target.value })} placeholder="Alert text" aria-label="Alert text" />
          ) : (
            <div className="flex flex-col gap-2">
              <Input value={a.title ?? ""} onChange={(e) => update(i, { title: e.target.value })} placeholder={a.type === "create_task" ? "Task title" : "Decision title"} aria-label="Title" />
              {a.type === "open_decision" ? (
                <Input
                  value={(a.options ?? []).join(" / ")}
                  onChange={(e) => update(i, { options: e.target.value.split("/").map((x) => x.trim()) })}
                  placeholder="Options, separated by /  (example: Continue the search / Accept a job)"
                  aria-label="Options"
                />
              ) : null}
            </div>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => setActions((x) => x.filter((_, j) => j !== i))} aria-label="Remove action">
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setActions((x) => [...x, { type: "create_task", title: "" }])}>
        <Plus /> Add action
      </Button>
    </div>
  );
}

/** Generic create and edit form built from the record definition. */
export function RecordForm({
  table,
  id,
  initial,
  refOptions,
  redirectTo,
  cancelHref,
  only,
  submitLabel,
  showSaveRule,
  extraHidden,
  hide,
  require,
  allowCreate = true,
  text,
}: {
  table: string;
  id?: string | null;
  initial: Row;
  refOptions: RefOptions;
  redirectTo?: string;
  cancelHref?: string;
  only?: string[];
  submitLabel?: string;
  showSaveRule?: boolean;
  extraHidden?: Record<string, string>;
  /** Fields left out of this form (example: deal source fields on a job item). */
  hide?: string[];
  /** Fields required on this form in addition to the record definition. */
  require?: string[];
  /** "+ New" next to reference fields. */
  allowCreate?: boolean;
  /** Labels and help that depend on the record (example: "Client" for the organization of a consulting item). */
  text?: Record<string, FieldText>;
}) {
  const resource = getResource(table)!;
  const [state, setState] = useState<FormState>(null);
  const [added, setAdded] = useState<RefOptions>({});
  const options = useMemo(() => {
    const out: RefOptions = { ...refOptions };
    for (const [t, list] of Object.entries(added)) for (const o of list) out[t] = addCreatedOption(out[t] ?? [], o);
    return out;
  }, [refOptions, added]);
  const ctx = useMemo<RefCtx>(() => ({ options, allowCreate, add: (t, o) => setAdded((a) => ({ ...a, [t]: [...(a[t] ?? []), o] })) }), [options, allowCreate]);
  const fields = resource.fields
    .filter((f) => !f.hideOnForm && !f.readOnly && (!only || only.includes(f.name)) && !hide?.includes(f.name))
    .map((f) => (require?.includes(f.name) ? { ...f, required: true } : f))
    .map((f) => (text?.[f.name] ? { ...f, label: text[f.name].label ?? f.label, help: text[f.name].help ?? f.help } : f));
  const suggestType = table === "pipeline_items" && fields.some((f) => f.name === "deal_source_type") && fields.some((f) => f.name === "source_contact_id");
  return (
    <RefContext.Provider value={ctx}>
      <GuardedForm action={(fd: FormData) => saveRecord(null, fd)} onResult={(r) => setState(r as FormState)} leaveTo className="flex flex-col gap-4">
        <input type="hidden" name="__table" value={table} />
        {id ? <input type="hidden" name="__id" value={id} /> : null}
        {redirectTo ? <input type="hidden" name="__redirect" value={redirectTo} /> : null}
        {Object.entries(extraHidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {state && !state.ok && state.error ? (
          <Notice tone="error">
            {state.error}
            {state.link ? (
              <>
                {" "}
                <Link href={state.link.href} className="font-medium underline">
                  {state.link.label}
                </Link>
              </>
            ) : null}
          </Notice>
        ) : null}
        <FieldGrid>
          {fields.map((f) => (
            <FormField
              key={f.name}
              label={f.label}
              htmlFor={`f_${f.name}`}
              required={f.required}
              help={suggestType && f.name === "deal_source_type" ? <DealSourceHint initialContact={initial.source_contact_id ?? ""} fallback={f.help} /> : f.help}
              wide={["textarea", "actions", "multiselect"].includes(f.type)}
            >
              <input type="hidden" name={`${f.name}__present`} value="1" />
              <FieldInput field={f} value={initial[f.name]} />
            </FormField>
          ))}
        </FieldGrid>
        {table === "tasks" && !id ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="__is_commitment" className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />
            <span>
              <span className="font-medium text-slate-800">This is a commitment</span>
              <span className="block text-xs text-muted-foreground">Checked against its due date; a miss needs a reason. Unchecked: a regular task, which moves to the next day if it is not done.</span>
            </span>
          </label>
        ) : null}
        {showSaveRule ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="save_rule" defaultChecked className="h-4 w-4 accent-teal-700" />
            When I change the category, save it as a rule for this merchant
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <SubmitButton data-save-and-leave>{submitLabel ?? (id ? "Save changes" : `Add ${resource.singular.toLowerCase()}`)}</SubmitButton>
          {cancelHref ? (
            <Button asChild variant="outline">
              <Link href={cancelHref}>Cancel</Link>
            </Button>
          ) : null}
        </div>
      </GuardedForm>
    </RefContext.Provider>
  );
}

type ContactOption = RefOption & { extra?: Row };

/**
 * Under "Deal source": the suggested type for the "Deal came from" contact (Brokered when that contact is a broker,
 * otherwise Proprietary), with a button to use it. Never changes a value the owner chose.
 */
function DealSourceHint({ initialContact, fallback }: { initialContact: string; fallback?: string }) {
  const ctx = useContext(RefContext);
  const anchor = useRef<HTMLSpanElement>(null);
  const [contactId, setContactId] = useState(initialContact);
  const [current, setCurrent] = useState<string>("");
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const read = () => {
      const c = form.elements.namedItem("source_contact_id") as HTMLInputElement | null;
      const t = form.elements.namedItem("deal_source_type") as HTMLSelectElement | null;
      setContactId(c?.value ?? "");
      setCurrent(t?.value ?? "");
    };
    read();
    form.addEventListener("change", read);
    form.addEventListener("input", read);
    return () => {
      form.removeEventListener("change", read);
      form.removeEventListener("input", read);
    };
  }, []);
  const contact = (ctx.options.contacts ?? []).find((o) => o.id === contactId) as ContactOption | undefined;
  const org = contact?.extra?.organization_id ? ((ctx.options.organizations ?? []).find((o) => o.id === contact.extra?.organization_id) as ContactOption | undefined) : undefined;
  const suggestion = contact ? suggestDealSourceType({ roles: contact.extra?.roles, organizationKind: org?.extra?.kind }) : null;
  const label = DEAL_SOURCE_OPTIONS.find((o) => o.value === suggestion)?.label.split(" (")[0];
  const use = () => {
    const form = anchor.current?.closest("form");
    const t = form?.elements.namedItem("deal_source_type") as HTMLSelectElement | null;
    if (!t || !suggestion) return;
    t.value = suggestion;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (!suggestion || !contact) return <span ref={anchor}>{fallback ?? "Choose \"Deal came from\" to see a suggestion."}</span>;
  const why = suggestion === "brokered" ? `${contact.label} is marked as a broker` : `${contact.label} is not marked as a broker`;
  return (
    <span ref={anchor} data-testid="deal-source-suggestion">
      Suggested: {label} ({why}).{" "}
      {current === suggestion ? null : (
        <button type="button" onClick={use} className="font-medium text-teal-800 underline">
          Use {label}
        </button>
      )}
    </span>
  );
}
