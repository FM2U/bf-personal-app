/**
 * Quick view: a centered window with a linked record's key fields, its Next required action, and its main
 * actions, opened by clicking a link to a task, contact, organization, pipeline item, goal, or milestone
 * (src/components/app/window-host.tsx). Pure helpers, tested in src/lib/quick-view.test.ts.
 */
import { getResource, type Field } from "@/lib/resources";
import { date as fmtDate, dateTime, money, num, pct } from "@/lib/format";
import { metricLabel } from "@/lib/metrics-list";
import type { Row } from "@/lib/types";

/** Records that open in the quick view when a link to them is clicked anywhere in the app. */
export const QUICK_VIEW_TABLES = ["tasks", "contacts", "organizations", "pipeline_items", "goals", "milestones"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The record a link points to, when the link is a plain record page (/records/<table>/<id>, no ?edit=1 or #section).
 * `anyTable` false (links on a page): only the quick view tables. True (links inside a window): any record type.
 */
export function parseRecordHref(href: string, opts: { anyTable?: boolean; origin?: string } = {}): { table: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(href, opts.origin ?? "http://localhost");
  } catch {
    return null;
  }
  if (opts.origin && url.origin !== opts.origin) return null;
  if (url.search || url.hash) return null;
  const m = url.pathname.match(/^\/records\/([a-z_]+)\/([^/]+)$/);
  if (!m || !UUID.test(m[2])) return null;
  const [, table, id] = m;
  if (!getResource(table)) return null;
  if (!opts.anyTable && !(QUICK_VIEW_TABLES as readonly string[]).includes(table)) return null;
  return { table, id };
}

/** A field value as plain text for the quick view ("" = empty, not shown). */
export function fieldText(field: Field, value: unknown, refTitle?: string): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "money":
      return money(value as number, true);
    case "percent":
      return pct(value as number, 3);
    case "number":
      return num(value as number, 2);
    case "date":
      return fmtDate(String(value));
    case "datetime":
      return dateTime(String(value));
    case "boolean":
      return value ? "Yes" : "No";
    case "ref":
      return refTitle ?? "";
    case "select": {
      if (field.name === "metric_key") return metricLabel(String(value));
      const label = field.options?.find((o) => o.value === String(value))?.label ?? String(value);
      return label.split(" (")[0];
    }
    case "multiselect":
    case "tags": {
      const arr = Array.isArray(value) ? value : [];
      return arr.map((v) => field.options?.find((o) => o.value === String(v))?.label.split(" (")[0] ?? String(v)).join(", ");
    }
    case "json":
    case "actions":
      return "";
    default:
      return String(value);
  }
}

/** Long text fields span the window; everything else sits in the compact grid. */
export function isWideField(field: Field): boolean {
  return field.type === "textarea";
}

/**
 * The fields shown in the quick view, in the record definition's order: filled in, not the title (it is the window
 * title), not hidden for this record, no raw data fields, no yes/no field that is No. At most `max`; long text comes last.
 */
export function quickFields(table: string, row: Row, hide: string[] = [], max = 12): Field[] {
  const r = getResource(table);
  if (!r) return [];
  const shown = r.fields.filter(
    (f) => f.name !== r.titleField && !hide.includes(f.name) && f.type !== "json" && f.type !== "actions" && !(f.type === "boolean" && !row[f.name]) && row[f.name] !== null && row[f.name] !== undefined && row[f.name] !== "" && !(Array.isArray(row[f.name]) && !(row[f.name] as unknown[]).length),
  );
  const short = shown.filter((f) => !isWideField(f));
  const long = shown.filter(isWideField);
  return [...short, ...long].slice(0, max);
}
