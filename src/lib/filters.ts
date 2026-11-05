/**
 * The Filter window's logic (Push B edits, 2026-11-03), pure and tested in src/lib/filters.test.ts. Reused by every
 * list with a Filter button (Contacts now; Screen listings, Deals, Job search, Consulting, and Sent reports later).
 *
 * A list has groups (the columns of the window), each with its choices. Ticks in one group mean either one (OR);
 * ticks in different groups must all match (AND). The number beside a choice is how many rows would show if that box
 * were ticked, given the ticks in the other groups (its own group's ticks are left out of that count).
 */

export type FilterOption = { value: string; label: string };

export type FilterGroup<T> = {
  key: string;
  title: string;
  options: readonly FilterOption[];
  /** True when the row matches this choice. */
  test: (row: T, value: string) => boolean;
  /** The words for the summary line ("contacted in the last 30 days"); the label when missing. */
  phrase?: (value: string) => string;
  /** The choices that apply while nothing in this group is ticked (Status: Active), so archived rows stay out by default. */
  default?: readonly string[];
};

/** The ticked choices by group key. */
export type Ticks = Record<string, readonly string[]>;

export const NO_TICKS: Ticks = {};

/** True when the row matches every group that has ticks (one of its ticks each); `skip` leaves one group out. */
export function passesFilters<T>(row: T, groups: readonly FilterGroup<T>[], ticks: Ticks, skip?: string): boolean {
  return groups.every((g) => {
    if (g.key === skip) return true;
    const ticked = ticks[g.key] ?? [];
    const on = ticked.length ? ticked : (g.default ?? []);
    return !on.length || on.some((v) => g.test(row, v));
  });
}

export function applyFilters<T>(rows: readonly T[], groups: readonly FilterGroup<T>[], ticks: Ticks): T[] {
  return rows.filter((r) => passesFilters(r, groups, ticks));
}

/** How many rows would show with this choice ticked, given the other groups' ticks. */
export function optionCount<T>(rows: readonly T[], groups: readonly FilterGroup<T>[], ticks: Ticks, groupKey: string, value: string): number {
  const g = groups.find((x) => x.key === groupKey);
  if (!g) return 0;
  return rows.filter((r) => passesFilters(r, groups, ticks, groupKey) && g.test(r, value)).length;
}

/** Every choice's count, by group and value. */
export function optionCounts<T>(rows: readonly T[], groups: readonly FilterGroup<T>[], ticks: Ticks): Record<string, Record<string, number>> {
  return Object.fromEntries(groups.map((g) => [g.key, Object.fromEntries(g.options.map((o) => [o.value, optionCount(rows, groups, ticks, g.key, o.value)]))]));
}

/** How many boxes are ticked ("Filter · 2"). Ticks for groups or choices the list does not have are not counted. */
export function tickedCount<T>(groups: readonly FilterGroup<T>[], ticks: Ticks): number {
  return groups.reduce((n, g) => n + (ticks[g.key] ?? []).filter((v) => g.options.some((o) => o.value === v)).length, 0);
}

/** The ticked choices as chips under the filter row, in the window's order. */
export function activeChips<T>(groups: readonly FilterGroup<T>[], ticks: Ticks): { group: string; groupTitle: string; value: string; label: string }[] {
  return groups.flatMap((g) => g.options.filter((o) => (ticks[g.key] ?? []).includes(o.value)).map((o) => ({ group: g.key, groupTitle: g.title, value: o.value, label: o.label })));
}

/** Ticks a box, or unticks it when it was ticked. */
export function toggleTick(ticks: Ticks, group: string, value: string): Ticks {
  const on = ticks[group] ?? [];
  const next = on.includes(value) ? on.filter((v) => v !== value) : [...on, value];
  const out: Record<string, readonly string[]> = { ...ticks, [group]: next };
  if (!next.length) delete out[group];
  return out;
}

export function clearGroup(ticks: Ticks, group: string): Ticks {
  const out: Record<string, readonly string[]> = { ...ticks };
  delete out[group];
  return out;
}

/**
 * "Showing people who are: Broker · contacted in the last 30 days · follow-up this week", or "Showing all people".
 * Choices in one group are joined with "or".
 */
export function filterSummary<T>(groups: readonly FilterGroup<T>[], ticks: Ticks, noun: string, who: "who are" | "that are" = "who are"): string {
  const parts = groups
    .map((g) => {
      const on = g.options.filter((o) => (ticks[g.key] ?? []).includes(o.value));
      return on.map((o) => (g.phrase ? g.phrase(o.value) : o.label)).join(" or ");
    })
    .filter(Boolean);
  return parts.length ? `Showing ${noun} ${who}: ${parts.join(" · ")}` : `Showing all ${noun}`;
}

/**
 * The label of a Filter button that opens the small dropdown (2026-11-04): what is on, in the window's order. "Area:
 * All", "Area: Deals, Rosara", and past two choices "Area: Deals, Rosara +2".
 */
export function filterButtonLabel<T>(prefix: string, groups: readonly FilterGroup<T>[], ticks: Ticks): string {
  const labels = groups.flatMap((g) => g.options.filter((o) => (ticks[g.key] ?? []).includes(o.value)).map((o) => o.label));
  if (!labels.length) return `${prefix}: All`;
  return `${prefix}: ${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2}` : ""}`;
}

/** "Show 1 person", "Show 12 people", "Show 4 organizations". */
export function showLabel(n: number, one: string, many: string): string {
  return `Show ${n} ${n === 1 ? one : many}`;
}

/**
 * The ticks as one address value ("role:broker,lender;lc:30"), so a reload or a shared link keeps them. Values are
 * letters, digits, "_" and "-" (the keys the lists use).
 */
export function ticksToParam(ticks: Ticks): string {
  return Object.entries(ticks)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}:${v.join(",")}`)
    .join(";");
}

export function parseTicks(param: string | null | undefined, groups?: readonly { key: string; options: readonly FilterOption[] }[]): Ticks {
  const out: Record<string, string[]> = {};
  for (const part of String(param ?? "").split(";")) {
    const [k, v] = part.split(":");
    if (!k || !v || !/^[a-z0-9_-]{1,40}$/i.test(k)) continue;
    const vals = [...new Set(v.split(",").filter((x) => /^[a-z0-9_-]{1,60}$/i.test(x)))];
    const g = groups?.find((x) => x.key === k);
    const kept = g ? vals.filter((x) => g.options.some((o) => o.value === x)) : groups ? [] : vals;
    if (kept.length) out[k] = kept;
  }
  return out;
}
