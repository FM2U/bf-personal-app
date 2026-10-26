/**
 * "+ New" next to a reference field: the short form for creating the referenced record without leaving the page.
 * Pure functions (tested). The dialog is src/components/app/ref-picker.tsx; saving uses createRecordInline in src/app/actions/records.ts.
 */
import { getResource, RESOURCES, type Field } from "@/lib/resources";

export type RefOption = { id: string; label: string };

/** Hand-picked short forms: the name plus the most useful fields. Every required field is always added. */
const QUICK_FIELDS: Record<string, string[]> = {
  contacts: ["name", "organization_id", "email", "phone", "relationship_group"],
  organizations: ["name", "kind", "website", "phone"],
  initiatives: ["name", "description"],
  goals: ["title", "initiative_id", "deadline"],
  categories: ["name", "kind"],
  income_sources: ["name"],
  funding_sources: ["name"],
};

const SIMPLE_TYPES = new Set(["text", "email", "url", "number", "money", "percent", "date", "select"]);
const MAX_OPTIONAL = 2;

/** Made on their own screen with extra setup (scenarios copy the current numbers), so no "+ New" in forms. */
const OWN_SCREEN = new Set(["scenarios"]);

/** Record types that can be created from a reference field. */
export function canQuickCreate(table: string | undefined): boolean {
  if (!table || OWN_SCREEN.has(table)) return false;
  const r = getResource(table);
  return !!r && !r.noCreate;
}

/**
 * The fields shown in the "+ New" dialog for a record type, in form order:
 * the hand-picked list (or the title field plus up to 2 simple optional fields), always with every required field.
 */
export function quickCreateFields(table: string): Field[] {
  const r = getResource(table);
  if (!r || !canQuickCreate(table)) return [];
  const editable = r.fields.filter((f) => !f.readOnly && !f.hideOnForm);
  const picked = QUICK_FIELDS[table];
  let names: Set<string>;
  if (picked) {
    names = new Set(picked);
  } else {
    names = new Set([r.titleField]);
    const optional = editable.filter((f) => !f.required && f.name !== r.titleField && SIMPLE_TYPES.has(f.type)).slice(0, MAX_OPTIONAL);
    for (const f of optional) names.add(f.name);
  }
  for (const f of editable) if (f.required) names.add(f.name);
  return editable.filter((f) => names.has(f.name));
}

/** Reference tables the "+ New" dialogs of a form need options for (example: Organization inside the new contact dialog). */
export function quickCreateRefTables(fields: Field[]): string[] {
  const out = new Set<string>();
  for (const f of fields) {
    if (f.type !== "ref" || !canQuickCreate(f.ref)) continue;
    for (const q of quickCreateFields(f.ref!)) if (q.type === "ref" && q.ref && RESOURCES[q.ref]) out.add(q.ref);
  }
  return [...out];
}

/** Adds a newly created record to a list of options (once), sorted like the list it joins: by label. */
export function addCreatedOption(options: RefOption[], created: RefOption): RefOption[] {
  if (options.some((o) => o.id === created.id)) return options;
  return [...options, created].sort((a, b) => a.label.localeCompare(b.label));
}

/** Options that match what was typed: every word must appear in the label (case and accents ignored). */
export function filterOptions(options: RefOption[], query: string): RefOption[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const label = normalize(o.label);
    return words.every((w) => label.includes(w));
  });
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
