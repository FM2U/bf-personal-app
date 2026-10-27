/**
 * Progressive disclosure: sections and cards that open and close (Inputs and Assumptions, record pages, long forms,
 * Settings, scenarios, reviews). The most-used sections start open; each viewer's choice is remembered per page kind
 * in this browser (localStorage, every read and write wrapped so blocked storage only means "not remembered").
 * Pure parts are tested in src/lib/disclosure.test.ts; the component is src/components/app/collapsible.tsx.
 */

/** Open state per section: the viewer's saved choice where there is one, otherwise the default. Unknown names are ignored. */
export function resolveOpen(defaults: Record<string, boolean>, saved: Record<string, boolean> | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, open] of Object.entries(defaults)) out[name] = saved && typeof saved[name] === "boolean" ? saved[name] : open;
  return out;
}

/** Every section open (Expand all) or closed (Collapse all). */
export function setAll(names: string[], open: boolean): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [n, open]));
}

export const DISCLOSURE_PREFIX = "disclosure:";
const PREFIX = DISCLOSURE_PREFIX;

/** The saved value as text (for useSyncExternalStore: a string compares by value). */
export function readRaw(fullKey: string): string | null {
  try {
    return window.localStorage.getItem(fullKey);
  } catch {
    return null;
  }
}

/** Parses a saved open-state map; anything else gives null. */
export function parseSaved(raw: string | null): Record<string, boolean> | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

export function readSaved(key: string): Record<string, boolean> | null {
  return parseSaved(readRaw(PREFIX + key));
}

/** Saves the viewer's choice for the given sections (other saved sections of the same key are kept). */
export function writeSaved(key: string, open: Record<string, boolean>) {
  try {
    const before = readSaved(key) ?? {};
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ ...before, ...open }));
  } catch {
    // Private windows and blocked storage: sections still open and close, they are just not remembered.
  }
}

/** One-line summary of a collapsed Inputs and Assumptions card: up to 3 values ("Runway target 12 months, ..."). */
export function inputsSummary(rows: { label: string; unit: string; value_number?: number | string | null; value_text?: string | null }[], max = 3): string {
  const shown = rows
    .map((r) => {
      const label = r.label.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
      const v = r.unit === "text" || r.unit === "date" ? r.value_text : r.value_number;
      if (v === null || v === undefined || v === "") return `${label}: not set`;
      const n = Number(v);
      const value =
        r.unit === "usd" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : r.unit === "percent" ? `${n}%` : r.unit === "months" ? `${n} months` : r.unit === "years" ? `${n} years` : r.unit === "boolean" ? (n >= 1 ? "yes" : "no") : String(v);
      return `${label}: ${value}`;
    })
    .slice(0, max);
  const more = rows.length > max ? `, and ${rows.length - max} more` : "";
  return `${shown.join(", ")}${more}`;
}
