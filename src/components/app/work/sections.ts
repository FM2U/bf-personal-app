"use client";

import { useCallback, useMemo, useState } from "react";
import { useSavedOpen } from "@/components/app/collapsible";
import { DISCLOSURE_PREFIX, writeSaved } from "@/lib/disclosure";

/**
 * The collapsible sections of a Work page (Home, Screen listings, Deals): which are collapsed, Collapse all and
 * Expand all, and the filter rule from Deals (approved 2026-10-30): while a filter other than All is on, a section
 * with a match is open and the rest are collapsed, and a heading toggled then is not remembered; back on All the
 * person's own collapsed set returns. The person's set is remembered in this browser under `storageKey`.
 */
type SectionState = { name: string; count: number; hasMatch: boolean; defaultOpen?: boolean };

export function useSections(storageKey: string, sections: readonly SectionState[], filtering: boolean) {
  const saved = useSavedOpen(DISCLOSURE_PREFIX + storageKey);
  /** The person's choices (All view), saved for the next visit. */
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  /** Headings toggled while a filter is on (not remembered; cleared when the filter changes). */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const ownOpen = useCallback((s: SectionState): boolean => changed[s.name] ?? saved?.[s.name] ?? s.defaultOpen ?? true, [changed, saved]);

  const isCollapsed = useCallback(
    (name: string): boolean => {
      const s = sections.find((x) => x.name === name);
      if (!s || !s.count) return false;
      if (!filtering) return !ownOpen(s);
      if (name in overrides) return overrides[name];
      return !s.hasMatch;
    },
    [sections, filtering, overrides, ownOpen],
  );

  const toggle = useCallback(
    (name: string) => {
      if (!filtering) {
        const s = sections.find((x) => x.name === name);
        const open = s ? !ownOpen(s) : true;
        writeSaved(storageKey, { [name]: open });
        setChanged((prev) => ({ ...prev, [name]: open }));
      } else {
        const now = isCollapsed(name);
        setOverrides((prev) => ({ ...prev, [name]: !now }));
      }
    },
    [filtering, sections, ownOpen, storageKey, isCollapsed],
  );

  /** Every section with rows: collapsed (true) or open (false). */
  const setAll = useCallback(
    (collapsed: boolean) => {
      const names = sections.filter((s) => s.count > 0).map((s) => s.name);
      const next = Object.fromEntries(names.map((n) => [n, collapsed]));
      if (!filtering) {
        writeSaved(storageKey, Object.fromEntries(names.map((n) => [n, !collapsed])));
        setChanged((prev) => ({ ...prev, ...Object.fromEntries(names.map((n) => [n, !collapsed])) }));
      } else {
        setOverrides((prev) => ({ ...prev, ...next }));
      }
    },
    [sections, filtering, storageKey],
  );

  const allCollapsed = useMemo(() => {
    const withRows = sections.filter((s) => s.count > 0);
    return withRows.length > 0 && withRows.every((s) => isCollapsed(s.name));
  }, [sections, isCollapsed]);

  /** Called when the filter changes: toggles made under the old filter are forgotten. */
  const resetOverrides = useCallback(() => setOverrides({}), []);

  return { isCollapsed, toggle, setAll, allCollapsed, resetOverrides, toggleAll: () => setAll(!allCollapsed) };
}
