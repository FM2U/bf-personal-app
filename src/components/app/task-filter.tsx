"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeFilterLabels, CLEAR_TASK_FILTERS, TASK_DUE, TASK_PRIORITIES, TASK_STATUSES, taskFilterQuery, type TaskFilters } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

type Group = keyof TaskFilters;

function Column({ title, group, options, picked, toggle, className }: { title: string; group: Group; options: readonly { value: string; label: string }[]; picked: TaskFilters; toggle: (g: Group, v: string) => void; className?: string }) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1", className)}>
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm text-slate-800 hover:bg-slate-50">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={picked[group].includes(o.value)} onChange={() => toggle(group, o.value)} data-testid={`filter-${group}-${o.value}`} />
          <span className="clamp-2 min-w-0">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * One "Filter" button for the task list. It opens a small panel with 3 columns of checkboxes (Status, Initiative,
 * Due date and Priority), Clear all, and Apply. Active filters show as small labels next to the button; each label's
 * x removes that filter. The filters live in the page address, so links, Back, and Forward keep them.
 */
export function TaskFilter({ filters, initiatives }: { filters: TaskFilters; initiatives: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskFilters>(filters);
  const box = useRef<HTMLDivElement>(null);
  const names = Object.fromEntries(initiatives.map((i) => [i.id, i.name]));
  const labels = activeFilterLabels(filters, names);
  const count = labels.length;
  const isDefault = taskFilterQuery(filters) === "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (g: Group, v: string) => setDraft((d) => ({ ...d, [g]: d[g].includes(v) ? d[g].filter((x) => x !== v) : [...d[g], v] }));
  const apply = (f: TaskFilters) => {
    setOpen(false);
    router.push(`/productivity/tasks${taskFilterQuery(f)}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="task-filter">
      <div className="relative" ref={box}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(filters);
            setOpen((o) => !o);
          }}
          data-testid="filter-button"
        >
          <Filter /> Filter{count ? <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-white">{count}</span> : null}
        </Button>
        {open ? (
          <div role="dialog" aria-label="Filter tasks" className="fixed inset-x-4 top-20 z-40 max-h-[75vh] overflow-y-auto rounded-xl border border-border bg-white p-4 shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[min(40rem,calc(100vw-2rem))] sm:overflow-visible" data-testid="filter-popover">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Column title="Status" group="status" options={TASK_STATUSES} picked={draft} toggle={toggle} />
              <Column title="Initiative" group="initiative" options={initiatives.map((i) => ({ value: i.id, label: i.name }))} picked={draft} toggle={toggle} className="max-h-60 overflow-y-auto" />
              <div className="flex flex-col gap-3">
                <Column title="Due date" group="due" options={TASK_DUE} picked={draft} toggle={toggle} />
                <Column title="Priority" group="priority" options={TASK_PRIORITIES} picked={draft} toggle={toggle} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-muted-foreground">No box checked in a column means any.</span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ status: [], initiative: [], due: [], priority: [] })} data-testid="filter-clear">
                  Clear all
                </Button>
                <Button type="button" size="sm" onClick={() => apply(draft)} data-testid="filter-apply">
                  Apply
                </Button>
              </span>
            </div>
          </div>
        ) : null}
      </div>
      {labels.map((l) => (
        <Link key={l.key} href={`/productivity/tasks${l.href === "?" ? "" : l.href}`} className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary-strong hover:bg-white" aria-label={`Remove filter: ${l.label}`} data-testid="filter-label">
          {l.label} <X aria-hidden className="h-3 w-3" />
        </Link>
      ))}
      {!isDefault ? (
        <Link href={CLEAR_TASK_FILTERS} className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" data-testid="filter-reset">
          Reset
        </Link>
      ) : null}
    </div>
  );
}
