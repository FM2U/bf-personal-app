"use client";

/**
 * A box that picks a person or an organization on file, or adds a new one by name (push K, Bram 2026-11-24;
 * claude/2026-11-24-broker-links-build-plan.md): the deal's Broker, Associate and Brokerage, and "Who" in Log a call.
 * Typing lists the matches; the first row offers to add the typed name when nothing on file has exactly that name. Up
 * and down move, Enter picks, Escape closes. The value is a record on file ({ id, name }), a new name ({ id: null,
 * name }), or null. Text left typed and not picked becomes the match of the same name, else a new name.
 */

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BrokerPick } from "@/lib/work/broker-links";

export type NameOption = { id: string; name: string; /** The quiet words after the name: the role and the organization, or the kind. */ sub?: string | null };

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
const MAX = 8;

export function NamePicker({ id, value, onChange, options, loading, addLabel, placeholder, testId, inputTestId, disabled, invalid, newNote = true }: { id?: string; value: BrokerPick; onChange: (v: BrokerPick) => void; options: readonly NameOption[]; /** The list is still being read. */ loading?: boolean; /** The words of the add row for the typed name ("Add "Thatcher Brown" as a new broker"). */ addLabel: (typed: string) => string; placeholder?: string; testId: string; /** The data-testid of the text box itself (default: testId + "-input"). */ inputTestId?: string; disabled?: boolean; invalid?: boolean; /** The "New: added when you save" line under the box (off where the place shows its own mark). */ newNote?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.name ?? "");
  const [shown, setShown] = useState(value);
  const [index, setIndex] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  // A value set from outside (the brokerage filled from the picked broker) shows in the box.
  if (shown !== value) {
    setShown(value);
    setText(value?.name ?? "");
  }
  const q = text.trim().toLowerCase();
  const typing = !!q && (!value || value.name.toLowerCase() !== q || open);
  const matches = (typing ? options.filter((o) => o.name.toLowerCase().includes(q)) : [...options]).sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, MAX);
  const exact = options.find((o) => o.name.trim().toLowerCase() === q) ?? null;
  const canAdd = !!q && !exact;
  const rows: ({ add: true } | { add: false; option: NameOption })[] = [...(canAdd ? [{ add: true as const }] : []), ...matches.map((option) => ({ add: false as const, option }))];

  const pick = (v: BrokerPick) => {
    setShown(v);
    setText(v?.name ?? "");
    setOpen(false);
    onChange(v);
  };
  /** Text left in the box: the record of that name, else a new name; empty clears. */
  const settle = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return value ? pick(null) : setOpen(false);
    if (value && value.name === t) return setOpen(false);
    pick(exact ? { id: exact.id, name: exact.name } : { id: null, name: t });
  };

  // A click outside the box settles the typed text. The listener is set again on each render while the list is open, so
  // it always settles what is typed now.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) settle();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  return (
    <div ref={wrap} className="relative min-w-0" data-testid={testId} data-picked={value ? (value.id ? "on-file" : "new") : "none"}>
      <div className="relative">
        <input
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setIndex((i) => Math.min(rows.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              if (!open) return;
              e.preventDefault();
              const r = rows[index];
              if (!r) return settle();
              pick(r.add ? { id: null, name: text.replace(/\s+/g, " ").trim() } : { id: r.option.id, name: r.option.name });
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setText(value?.name ?? "");
              setOpen(false);
            } else if (e.key === "Tab") settle();
          }}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          title={value?.name || undefined}
          className={cn(INPUT, "truncate", value ? "pr-8" : null, invalid ? "border-status-missed" : null)}
          data-testid={inputTestId ?? `${testId}-input`}
        />
        {value && !disabled ? (
          <button type="button" onClick={() => pick(null)} aria-label="Clear" className="absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid={`${testId}-clear`}>
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {newNote && value && !value.id && !open ? (
        <p className="mt-1 text-[12px] leading-4 text-status-met" data-testid={`${testId}-new`}>
          New: added when you save
        </p>
      ) : null}
      {open && !disabled ? (
        <div id={listId} role="listbox" className="absolute top-[40px] right-0 left-0 z-30 max-h-[264px] overflow-y-auto rounded-[8px] border border-border bg-white py-1 text-[13.5px] shadow-lg" data-testid={`${testId}-list`}>
          {rows.map((r, i) =>
            r.add ? (
              <button key="__add" type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ id: null, name: text.replace(/\s+/g, " ").trim() })} className={cn("block w-full px-2.5 py-2 text-left font-medium text-primary-strong", i === index ? "bg-primary-soft" : "bg-slate-50")} data-testid={`${testId}-add`}>
                + {addLabel(text.replace(/\s+/g, " ").trim())}
              </button>
            ) : (
              <button key={r.option.id} type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ id: r.option.id, name: r.option.name })} className={cn("block w-full truncate px-2.5 py-2 text-left text-slate-900", i === index ? "bg-primary-soft" : null)} data-testid={`${testId}-option`}>
                {r.option.name}
                {r.option.sub ? <span className="text-[12.5px] text-muted-foreground"> · {r.option.sub}</span> : null}
              </button>
            ),
          )}
          {!rows.length ? <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{loading ? "Reading the list..." : "Type a name."}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
