/**
 * The shared Link to picker (push C, approved 2026-11-02), pure and tested in src/lib/work/link-picker.test.ts.
 * Before typing it lists today's records (the ones with a next action due today or earlier, and the ones opened
 * today); while typing it lists matches across deals, listings, people, organizations, projects, job search and
 * consulting. Both are grouped by type with a short status. The type chips narrow the list (listings sit under
 * Deals); with a type chosen and no match, "Search all types" is offered when another type has one. Closed records
 * (passed, lost, archived) are left out unless their name is typed (three letters or more).
 */
import type { RecordKind } from "@/lib/work/task-records";

export type LinkRecord = {
  kind: RecordKind;
  id: string;
  name: string;
  /** The short status at the right: the stage, the role, or the kind. */
  status: string;
  closed: boolean;
  /** Has a next action or follow-up due today or earlier. */
  dueToday: boolean;
};

export const PICKER_CHIPS = ["All", "Deals", "People", "Organizations", "Projects", "Jobs", "Consulting"] as const;
export type PickerChip = (typeof PICKER_CHIPS)[number];

const CHIP_OF: Record<RecordKind, Exclude<PickerChip, "All">> = { deal: "Deals", listing: "Deals", person: "People", organization: "Organizations", project: "Projects", job: "Jobs", consulting: "Consulting" };

export function chipOf(kind: RecordKind): Exclude<PickerChip, "All"> {
  return CHIP_OF[kind];
}

/** A record's key in "opened today" ("deal:<id>"). */
export function linkKey(r: Pick<LinkRecord, "kind" | "id">): string {
  return `${r.kind === "listing" ? "deal" : r.kind}:${r.id}`;
}

const MAX_WHILE_TYPING = 40;
const CLOSED_FROM = 3;

function matches(r: LinkRecord, q: string): boolean {
  const name = r.name.toLowerCase();
  if (r.closed) return q.length >= CLOSED_FROM && name.includes(q);
  return name.includes(q) || r.status.toLowerCase().includes(q);
}

export type PickerResult = {
  groups: { label: Exclude<PickerChip, "All">; items: LinkRecord[] }[];
  /** The items in the order shown (for the arrow keys). */
  flat: LinkRecord[];
  /** What the empty list says: nothing today, no match at all, or no match in the chosen type (offer all types). */
  empty: null | "nothing-today" | "no-match" | "no-match-in-type";
};

/** The list the picker shows for the typed text and the chosen chip. `opened` holds the keys of records opened today. */
export function pickerResults(records: readonly LinkRecord[], query: string, chip: PickerChip, opened: ReadonlySet<string> = new Set()): PickerResult {
  const q = query.trim().toLowerCase();
  const pool = q ? records.filter((r) => matches(r, q)) : records.filter((r) => !r.closed && (r.dueToday || opened.has(linkKey(r))));
  const typed = chip === "All" ? pool : pool.filter((r) => chipOf(r.kind) === chip);
  const rank = (r: LinkRecord) => (q ? (r.name.toLowerCase().startsWith(q) ? 0 : 1) : 0) + (r.closed ? 2 : 0);
  const sorted = [...typed].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const cut = q ? sorted.slice(0, MAX_WHILE_TYPING) : sorted;
  const groups = PICKER_CHIPS.filter((c): c is Exclude<PickerChip, "All"> => c !== "All")
    .map((label) => ({ label, items: cut.filter((r) => chipOf(r.kind) === label) }))
    .filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);
  let empty: PickerResult["empty"] = null;
  if (!flat.length) empty = !q ? "nothing-today" : chip !== "All" && pool.length ? "no-match-in-type" : "no-match";
  return { groups, flat, empty };
}

/** The highlighted row after an arrow key (stays inside the list). */
export function movePick(index: number, delta: number, length: number): number {
  if (!length) return 0;
  return Math.max(0, Math.min(length - 1, index + delta));
}
