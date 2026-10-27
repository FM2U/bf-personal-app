/**
 * Layout of the shared record form (src/components/app/record-form.tsx). Pure, tested in src/lib/form-layout.test.ts.
 *
 * - Width by content: dates, numbers, money, percentages, phone numbers, yes/no, and short dropdowns are short (4 to a row on a
 *   wide form, 2 on a narrow one); names, links, references, and long dropdowns are medium (2 to a row); long text,
 *   checkbox lists, and rule builders take the whole row. The form itself is held to about 880px.
 * - Sections: fields are grouped under their section heading (in the order the sections first appear); within a
 *   section, required fields come first.
 * - More details: optional fields that are rarely needed (ADVANCED below, raw data fields, order numbers) are kept
 *   behind a "More details" disclosure when there are at least 2 of them; it opens by itself when one of them holds
 *   a value (editing). Required fields are never hidden.
 */
import type { Field } from "@/lib/resources";

export type FieldWidth = "short" | "medium" | "full";

/** Longest option label (in characters) that still counts as a short dropdown. */
const SHORT_SELECT_MAX = 24;

export function fieldWidth(f: Field): FieldWidth {
  // Phone numbers are short text.
  if (f.type === "text" && /phone/.test(f.name)) return "short";
  switch (f.type) {
    case "date":
    case "number":
    case "money":
    case "percent":
    case "boolean":
      return "short";
    case "select": {
      const longest = Math.max(0, ...(f.options ?? []).map((o) => o.label.length));
      return longest <= SHORT_SELECT_MAX ? "short" : "medium";
    }
    case "textarea":
    case "multiselect":
    case "actions":
    case "json":
      return "full";
    default:
      return "medium";
  }
}

/** Grid classes per width (12 columns; the form is a size container, so the spans follow the form's own width). */
export const WIDTH_CLASS: Record<FieldWidth, string> = {
  short: "col-span-12 @md:col-span-6 @2xl:col-span-3",
  medium: "col-span-12 @2xl:col-span-6",
  full: "col-span-12",
};

const BASE_SPAN: Record<FieldWidth, number> = { short: 3, medium: 6, full: 12 };
/** Narrowest a medium field may become to make room for a short field in the same row (4 of 12 = a third). */
const MEDIUM_MIN = 4;
/** Written out in full so Tailwind generates each class. */
const WIDE_SPAN: Record<number, string> = { 3: "@2xl:col-span-3", 4: "@2xl:col-span-4", 5: "@2xl:col-span-5", 6: "@2xl:col-span-6", 12: "@2xl:col-span-12" };

/**
 * Column spans (of 12) on a wide form, packed row by row in field order: short 3, medium 6, full 12. When a short
 * field does not fit at the end of a row, the medium fields in that row give up columns (down to 4 each) so it fits,
 * instead of leaving it alone on the next row. Example: Goal, Initiative, Deadline become 5, 4, 3.
 */
export function packSpans(widths: FieldWidth[]): number[] {
  const spans = widths.map((w) => BASE_SPAN[w]);
  let row: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    const need = spans[i];
    if (used + need <= 12) {
      row.push(i);
      used += need;
      return;
    }
    const mediums = row.filter((j) => widths[j] === "medium");
    const room = mediums.reduce((sum, j) => sum + (spans[j] - MEDIUM_MIN), 0);
    let short = used + need - 12;
    if (w === "short" && short <= room) {
      for (let k = mediums.length - 1; k >= 0 && short > 0; k--) {
        const j = mediums[k];
        const give = Math.min(spans[j] - MEDIUM_MIN, short);
        spans[j] -= give;
        short -= give;
      }
      row.push(i);
      used = 12;
      return;
    }
    row = [i];
    used = need;
  });
  return spans;
}

/** Grid classes for each field of a group (spans on a wide form from packSpans; narrow forms use WIDTH_CLASS). */
export function spanClasses(fields: Field[], widthOf: (f: Field) => FieldWidth = fieldWidth): string[] {
  const widths = fields.map(widthOf);
  const spans = packSpans(widths);
  return widths.map((w, i) => (w === "full" ? WIDTH_CLASS.full : `${w === "short" ? "col-span-12 @md:col-span-6" : "col-span-12"} ${WIDE_SPAN[spans[i]] ?? WIDE_SPAN[BASE_SPAN[w]]}`));
}

/** Optional fields kept behind "More details", per record type. */
export const ADVANCED: Record<string, string[]> = {
  goals: ["status", "notes"],
  milestones: ["current_value", "status", "proof_type", "proof_value", "next_milestone_id", "notes"],
  tasks: ["status", "goal_id", "milestone_id", "pipeline_item_id"],
  targets: ["pipeline_id", "stage_id", "initiative_id", "start_date", "show_to_partners", "active", "notes"],
  contacts: ["is_pseudonym", "mailing_address", "outreach_every_days"],
  pipeline_items: ["source_notes"],
  initiatives: ["is_active"],
  decision_conditions: ["check_from", "is_active"],
  accounts: ["is_active"],
  debts: ["notes"],
};

/** Section headings added to forms that have none in the record definition (fields not listed keep no section). */
export const FORM_SECTIONS: Record<string, Record<string, string>> = {
  goals: { title: "Goal", initiative_id: "Goal", deadline: "Goal", metric_key: "How it is measured", comparison: "How it is measured", target_value: "How it is measured", metric_params: "How it is measured" },
  milestones: { title: "Milestone", goal_id: "Milestone", due_date: "Milestone", completion_test: "Milestone", target_value: "Milestone" },
  targets: { name: "Target", period: "Target", minimum_count: "Target", count_source: "Target", active_weekdays: "Target", is_commitment: "Target" },
};

export function isAdvanced(table: string, f: Field): boolean {
  if (f.required) return false;
  if (f.type === "json" || f.name === "sort_order") return true;
  return (ADVANCED[table] ?? []).includes(f.name);
}

export type FormGroup = { section: string | null; fields: Field[] };

/** Fields grouped by section (first appearance order), required first within each section. */
export function groupFields(table: string, fields: Field[]): FormGroup[] {
  const extra = FORM_SECTIONS[table] ?? {};
  const out: FormGroup[] = [];
  for (const f of fields) {
    const section = f.section ?? extra[f.name] ?? null;
    let g = out.find((x) => x.section === section);
    if (!g) {
      g = { section, fields: [] };
      out.push(g);
    }
    g.fields.push(f);
  }
  for (const g of out) g.fields = [...g.fields.filter((f) => f.required), ...g.fields.filter((f) => !f.required)];
  // Fields with no section come after the named sections when there are named sections (they are the "other" fields).
  const named = out.filter((g) => g.section);
  const unnamed = out.filter((g) => !g.section);
  return named.length ? [...named, ...unnamed.map((g) => ({ ...g, section: "Other details" }))] : out;
}

/**
 * The form split into the main groups and the "More details" fields (empty when fewer than 2 fields qualify,
 * then every field stays in the main groups).
 */
export function formLayout(table: string, fields: Field[]): { main: FormGroup[]; more: Field[] } {
  const more = fields.filter((f) => isAdvanced(table, f));
  if (more.length < 2) return { main: groupFields(table, fields), more: [] };
  return { main: groupFields(table, fields.filter((f) => !isAdvanced(table, f))), more };
}

/** "More details" starts open when one of its fields holds a value other than its default (editing a record). */
export function moreStartsOpen(more: Field[], initial: Record<string, unknown>): boolean {
  return more.some((f) => {
    const v = initial[f.name];
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (f.default !== undefined && String(v) === String(f.default)) return false;
    if (f.type === "boolean" && f.default === undefined && v === false) return false;
    return true;
  });
}
