/**
 * List filters (the Filter button and panel on list pages: contacts, organizations, communications, reviews, pipeline
 * item lists, commitments, expenses). The filter state lives in the page address as `?<key>=<value>,<value>`, so links,
 * Back, and Forward keep it, as on Task lists (src/lib/task-filters.ts). No box checked in a column means any value;
 * a column with defaults (Commitments: Status open) uses them while its key is not in the address, and `key=all`
 * means any value. Pure functions, tested in src/lib/list-filters.test.ts; the panel is src/components/app/filter-panel.tsx.
 */
import { addDaysISO } from "@/lib/calc/dates";
import type { Field } from "@/lib/resources";

export type FilterOption = { value: string; label: string };
export type FilterColumn = { key: string; title: string; options: FilterOption[]; defaults?: string[]; /** Added after a value in its label ("High priority"). */ chipSuffix?: string };
/** The panel's visual columns; each holds one or more filter columns stacked (Due date over Priority). */
export type FilterLayout = FilterColumn[][];
export type FilterState = Record<string, string[]>;
type Params = Record<string, string | string[] | undefined> | URLSearchParams;
type Row = Record<string, unknown>;

function values(sp: Params, key: string): string[] | null {
  const raw = sp instanceof URLSearchParams ? sp.getAll(key) : ([] as string[]).concat(sp[key] ?? []);
  if (!raw.length) return null;
  return [...new Set(raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
}

/** The filters in an address: unknown values are left out; a missing key uses the column's defaults. */
export function readFilters(sp: Params, columns: FilterColumn[]): FilterState {
  const out: FilterState = {};
  for (const c of columns) {
    const v = values(sp, c.key);
    const allowed = new Set(c.options.map((o) => o.value));
    out[c.key] = v === null ? [...(c.defaults ?? [])] : v.includes("all") ? [] : v.filter((x) => allowed.has(x));
  }
  return out;
}

/** True when every column is at its default. */
export function isDefaultFilters(state: FilterState, columns: FilterColumn[]): boolean {
  return columns.every((c) => sameSet(state[c.key] ?? [], c.defaults ?? []));
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * The address for `state` on `path`, keeping the other parameters in `keep` (a window parameter `w` is never kept).
 * A column at its default is left out; an emptied column with defaults is written `key=all`.
 */
export function filterHref(path: string, state: FilterState, columns: FilterColumn[], keep: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  const keys = new Set(columns.map((c) => c.key));
  for (const [k, v] of Object.entries(keep)) if (k !== "w" && !keys.has(k) && v) q.set(k, v);
  for (const c of columns) {
    const v = state[c.key] ?? [];
    if (sameSet(v, c.defaults ?? [])) continue;
    q.set(c.key, v.length ? v.join(",") : "all");
  }
  const s = q.toString().replace(/%2C/g, ",");
  return `${path}${s ? `?${s}` : ""}`;
}

/** The small removable labels next to the Filter button, each with the address after removing it. */
export function activeLabels(state: FilterState, columns: FilterColumn[], hrefFor: (s: FilterState) => string): { key: string; label: string; href: string }[] {
  const out: { key: string; label: string; href: string }[] = [];
  for (const c of columns) {
    for (const v of state[c.key] ?? []) {
      const label = c.options.find((o) => o.value === v)?.label ?? v;
      const text = /^(Yes|No|Not set)$/.test(label) ? `${c.title}: ${label}` : c.chipSuffix ? `${label} ${c.chipSuffix}` : label;
      out.push({ key: `${c.key}:${v}`, label: text, href: hrefFor({ ...state, [c.key]: (state[c.key] ?? []).filter((x) => x !== v) }) });
    }
  }
  return out;
}

// ---------- Filters made from record fields ----------

export type DateMode = "due" | "past";
export const DUE_BUCKETS: FilterOption[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "later", label: "Later" },
  { value: "none", label: "No date" },
];
export const PAST_BUCKETS: FilterOption[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "older", label: "Older" },
  { value: "none", label: "No date" },
];

/** Which date bucket a date falls in ("Next 7 days" includes today; "Last 30 days" includes the last 7). */
export function dateMatches(raw: unknown, picked: string[], mode: DateMode, today: string): boolean {
  const d = typeof raw === "string" && raw ? raw.slice(0, 10) : null;
  if (!d) return picked.includes("none");
  if (mode === "due") {
    const bucket = d < today ? "overdue" : d === today ? "today" : d <= addDaysISO(today, 7) ? "week" : "later";
    return picked.includes(bucket) || (bucket === "today" && picked.includes("week"));
  }
  if (d > today) return false;
  return picked.some((p) => (p === "older" ? d < addDaysISO(today, -90) : /^\d+$/.test(p) && d >= addDaysISO(today, -Number(p))));
}

export type FilterSpec = { column: FilterColumn; test: (row: Row, picked: string[], today: string) => boolean };
export const NOT_SET = "none";

/**
 * A filter column made from a record field: choices (select, multiselect), Yes and No (yes/no fields), records
 * (reference fields, with "Not set"), or date buckets (due dates: Overdue to Later; past dates: Last 7 days to Older).
 */
export function fieldFilter(field: Field, opts: { refOptions?: { id: string; label: string }[]; dateMode?: DateMode; title?: string; defaults?: string[] } = {}): FilterSpec | null {
  const title = opts.title ?? field.label.replace(/\s*\(.*\)$/, "");
  const col = (options: FilterOption[]): FilterColumn => ({ key: field.name, title, options, defaults: opts.defaults });
  const v = (row: Row) => row[field.name];
  switch (field.type) {
    case "select":
      return {
        column: col([...(field.options ?? []), ...(field.required ? [] : [{ value: NOT_SET, label: "Not set" }])]),
        test: (row, picked) => (v(row) === null || v(row) === undefined || v(row) === "" ? picked.includes(NOT_SET) : picked.includes(String(v(row)))),
      };
    case "multiselect":
    case "tags":
      return {
        column: col(field.options ?? []),
        test: (row, picked) => Array.isArray(v(row)) && (v(row) as unknown[]).some((x) => picked.includes(String(x))),
      };
    case "boolean":
      return { column: col([{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]), test: (row, picked) => picked.includes(v(row) ? "yes" : "no") };
    case "ref":
      return {
        column: col([...(opts.refOptions ?? []).map((o) => ({ value: o.id, label: o.label })), { value: NOT_SET, label: "Not set" }]),
        test: (row, picked) => (v(row) ? picked.includes(String(v(row))) : picked.includes(NOT_SET)),
      };
    case "date":
    case "datetime": {
      const mode = opts.dateMode ?? "due";
      return { column: col(mode === "due" ? DUE_BUCKETS : PAST_BUCKETS), test: (row, picked, today) => dateMatches(v(row), picked, mode, today) };
    }
    default:
      return null;
  }
}

/** The rows that pass every column with a box checked. */
export function applyFilters<T extends Row>(rows: T[], specs: FilterSpec[], state: FilterState, today: string): T[] {
  const active = specs.filter((s) => (state[s.column.key] ?? []).length);
  if (!active.length) return rows;
  return rows.filter((r) => active.every((s) => s.test(r, state[s.column.key], today)));
}

/** The search parameters of a page as plain strings (for `keep`). */
export function plainParams(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") out[k] = v;
  else if (Array.isArray(v) && v.length) out[k] = v.join(",");
  return out;
}
