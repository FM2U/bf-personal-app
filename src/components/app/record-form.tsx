"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { saveRecord, type FormState } from "@/app/actions/records";
import { getResource, type Field } from "@/lib/resources";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/app/submit-button";
import { Notice } from "@/components/app/page-header";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";

type RefOptions = Record<string, { id: string; label: string }[]>;

function toInputValue(field: Field, v: unknown): string {
  if (v === null || v === undefined) return field.default !== undefined && typeof field.default !== "boolean" ? String(field.default) : "";
  if (field.type === "datetime" && typeof v === "string") return v.slice(0, 16);
  if (field.type === "json") return typeof v === "string" ? v : JSON.stringify(v);
  return String(v);
}

function FieldInput({ field, value, refOptions }: { field: Field; value: unknown; refOptions: RefOptions }) {
  const common = { id: `f_${field.name}`, name: field.name, required: field.required && field.type !== "boolean" };
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
          <input type="checkbox" name={field.name} defaultChecked={checked} className="h-4 w-4 accent-teal-700" />
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
    case "ref": {
      const opts = refOptions[field.ref!] ?? [];
      return (
        <NativeSelect {...common} defaultValue={toInputValue(field, value)}>
          <option value="">{opts.length ? "Choose" : "None added yet"}</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    }
    case "multiselect": {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
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

type ActionDraft = { type: "create_task" | "create_alert" | "open_decision"; title?: string; message?: string; options?: string[] };

/** Builds the list of required actions for a decision condition. */
export function ActionsEditor({ name, initial }: { name: string; initial: Row[] }) {
  const [actions, setActions] = useState<ActionDraft[]>(initial.length ? (initial as ActionDraft[]) : [{ type: "create_task", title: "" }]);
  const update = (i: number, patch: Partial<ActionDraft>) => setActions((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const clean = actions
    .map((a) =>
      a.type === "create_task"
        ? { type: a.type, title: a.title ?? "" }
        : a.type === "create_alert"
          ? { type: a.type, message: a.message ?? "" }
          : { type: a.type, title: a.title ?? "", options: (a.options ?? []).filter(Boolean) },
    )
    .filter((a) => ("title" in a ? a.title : a.message));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-input bg-background p-3">
      <input type="hidden" name={name} value={JSON.stringify(clean)} />
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
}) {
  const resource = getResource(table)!;
  const [state, action] = useActionState<FormState, FormData>(saveRecord, null);
  const fields = resource.fields.filter((f) => !f.hideOnForm && !f.readOnly && (!only || only.includes(f.name)));
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="__table" value={table} />
      {id ? <input type="hidden" name="__id" value={id} /> : null}
      {redirectTo ? <input type="hidden" name="__redirect" value={redirectTo} /> : null}
      {Object.entries(extraHidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state && !state.ok && state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {fields.map((f) => {
          const wide = ["textarea", "actions", "multiselect"].includes(f.type);
          return (
            <div key={f.name} className={cn("flex min-w-0 flex-col", wide && "sm:col-span-2")}>
              <input type="hidden" name={`${f.name}__present`} value="1" />
              <label htmlFor={`f_${f.name}`} className={cn("text-sm font-medium text-slate-800", !wide && "field-label flex items-end")}>
                <span>
                  {f.label}
                  {f.required ? <span className="text-red-600"> *</span> : null}
                </span>
              </label>
              <div className={cn(wide && "mt-1")}>
                <FieldInput field={f} value={initial[f.name]} refOptions={refOptions} />
              </div>
              {f.help ? <p className="clamp-2 mt-1 text-xs text-muted-foreground">{f.help}</p> : null}
            </div>
          );
        })}
      </div>
      {showSaveRule ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="save_rule" defaultChecked className="h-4 w-4 accent-teal-700" />
          When I change the category, save it as a rule for this merchant
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel ?? (id ? "Save changes" : `Add ${resource.singular.toLowerCase()}`)}</SubmitButton>
        {cancelHref ? (
          <Button asChild variant="outline">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
