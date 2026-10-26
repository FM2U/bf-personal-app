/**
 * Unsaved changes: compares what a form holds now with what it held when it was shown.
 * Pure functions (tested); the browser part that reads the fields is in src/components/app/unsaved-changes.tsx.
 */

/** One form field, read from the page. */
export type FieldState =
  | { kind: "value"; value: string; initial: string }
  | { kind: "check"; checked: boolean; initial: boolean }
  | { kind: "select"; selected: boolean[]; initial: boolean[]; multiple: boolean }
  | { kind: "file"; count: number }
  | { kind: "ignore" };

/** For a single-choice list where no option is marked as the starting choice, the browser starts on the first option. */
export function initialSelection(defaults: boolean[], multiple: boolean): boolean[] {
  if (multiple || defaults.some(Boolean) || !defaults.length) return defaults;
  return defaults.map((_, i) => i === 0);
}

export function isFieldDirty(f: FieldState): boolean {
  switch (f.kind) {
    case "value":
      return f.value !== f.initial;
    case "check":
      return f.checked !== f.initial;
    case "select": {
      const initial = initialSelection(f.initial, f.multiple);
      if (initial.length !== f.selected.length) return true;
      return f.selected.some((s, i) => s !== initial[i]);
    }
    case "file":
      return f.count > 0;
    default:
      return false;
  }
}

export function isFormDirty(fields: FieldState[]): boolean {
  return fields.some(isFieldDirty);
}

/** Buttons and fields without a name are never saved, so they never count as a change. */
export const IGNORED_INPUT_TYPES = new Set(["submit", "button", "reset", "image"]);

/**
 * Where "Save and leave" may send the saved form directly (the server redirects there after saving).
 * Only paths inside the app; downloads and API routes are left to the link itself.
 */
export function safeLeaveTarget(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return null;
  return href;
}
