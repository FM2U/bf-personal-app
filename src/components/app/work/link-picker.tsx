"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { readRaw } from "@/lib/disclosure";
import { linkKey, movePick, PICKER_CHIPS, pickerResults, type LinkRecord, type PickerChip } from "@/lib/work/link-picker";
import { RECORD_KIND_LABEL } from "@/lib/work/task-records";
import { cn } from "@/lib/utils";

/**
 * The shared Link to picker (push C, approved 2026-11-02): one component, used by Add a to-do and the to-do edit box
 * (and ready for other places). A click opens today's records (today's next actions and the records opened today),
 * grouped by type; typing finds any record across deals, listings, people, organizations, projects, job search and
 * consulting, each with a short status. Type chips at the top narrow it (listings under Deals); with a type chosen
 * and no match it offers "Search all types". Up and down move, Enter picks, Escape closes. The picked record shows as
 * a chip with a remove ×. Closed records are left out unless their name is typed.
 */

/** Where the record pages note what was opened today (this browser only). */
export const OPENED_STORAGE_PREFIX = "work-opened-records:";

export function rememberOpened(today: string, key: string) {
  try {
    const k = OPENED_STORAGE_PREFIX + today;
    const list = JSON.parse(window.localStorage.getItem(k) ?? "[]") as string[];
    if (!list.includes(key)) window.localStorage.setItem(k, JSON.stringify([key, ...list].slice(0, 60)));
  } catch {
    /* no storage */
  }
}

function openedToday(today: string): Set<string> {
  try {
    const v = JSON.parse(readRaw(OPENED_STORAGE_PREFIX + today) ?? "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function LinkPicker({ records, value, onChange, today, placeholder = "Click to pick, or type to find a record", testId = "link-picker", inputId }: { records: readonly LinkRecord[]; value: LinkRecord | null; onChange: (r: LinkRecord | null) => void; today: string; placeholder?: string; testId?: string; inputId?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<PickerChip>("All");
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const res = useMemo(() => pickerResults(records, query, chip, opened), [records, query, chip, opened]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const show = () => {
    setOpened(openedToday(today));
    setOpen(true);
  };
  const pick = (r: LinkRecord) => {
    onChange(r);
    setOpen(false);
    setQuery("");
    setChip("All");
    setIndex(0);
  };

  if (value) {
    return (
      <div className="flex h-9 min-w-0 items-center" data-testid={testId} data-picked={linkKey(value)}>
        <span className="inline-flex h-[26px] max-w-full items-center gap-1 rounded-full border border-border bg-white pr-1 pl-2.5 text-[12.5px] font-medium" data-testid="link-chip">
          <span className="text-slate-500">{RECORD_KIND_LABEL[value.kind]} ·</span>
          <span className="min-w-0 truncate text-slate-800">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Remove the link to ${value.name}`} data-testid="link-chip-remove">
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div ref={wrap} className="relative min-w-0" data-testid={testId}>
      <input
        ref={input}
        id={inputId}
        value={query}
        onFocus={show}
        onClick={() => !open && show()}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
          if (!open) show();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) show();
            setIndex((i) => movePick(i, 1, res.flat.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => movePick(i, -1, res.flat.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const r = res.flat[index];
            if (open && r) pick(r);
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={INPUT}
        data-testid={`${testId}-input`}
      />
      {open ? (
        <div id={listId} role="listbox" className="absolute top-[calc(100%+4px)] right-0 left-0 z-30 max-h-[340px] min-w-[300px] overflow-y-auto rounded-[10px] border border-border bg-white pb-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)]" data-testid={`${testId}-list`}>
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-2.5 pt-2.5 pb-2" data-testid={`${testId}-chips`}>
            {PICKER_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setChip(c);
                  setIndex(0);
                  input.current?.focus();
                }}
                className={cn("rounded-full border px-2.5 py-[3px] text-[12px] font-medium", chip === c ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")}
                aria-pressed={chip === c}
                data-testid={`${testId}-chip`}
                data-chip={c}
              >
                {c}
              </button>
            ))}
          </div>
          {!query.trim() ? <div className="px-3 pt-2 text-[11.5px] text-slate-400">Today&apos;s records · type to find any record</div> : null}
          {res.groups.map((g) => (
            <div key={g.label} data-testid={`${testId}-group`} data-group={g.label}>
              <div className="label-caps px-3 pt-2.5 pb-1 text-[10.5px] text-slate-500">{g.label}</div>
              {g.items.map((r) => {
                const i = res.flat.indexOf(r);
                return (
                  <button
                    key={`${r.kind}:${r.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => pick(r)}
                    className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-[7px] text-left text-[13.5px]", i === index ? "bg-primary-soft" : "hover:bg-slate-50")}
                    data-testid={`${testId}-option`}
                    data-key={linkKey(r)}
                    data-active={i === index ? "1" : "0"}
                  >
                    <span className="min-w-0 truncate text-slate-900">{r.name}</span>
                    <span className={cn("max-w-[150px] truncate text-[12px]", r.closed ? "text-slate-400 italic" : "text-slate-500")}>{r.status}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {res.empty ? (
            <p className="px-3 pt-3 pb-2 text-[13px] text-muted-foreground" data-testid={`${testId}-empty`}>
              {res.empty === "nothing-today" ? (
                "Nothing here today. Type to find any record."
              ) : res.empty === "no-match-in-type" ? (
                <>
                  No match in {chip}.{" "}
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setChip("All")} className="font-medium text-primary-strong hover:underline" data-testid={`${testId}-all-types`}>
                    Search all types
                  </button>
                </>
              ) : (
                "No record matches. Closed records show when you type their name."
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
