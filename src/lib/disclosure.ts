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

function readSaved(key: string): Record<string, boolean> | null {
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
