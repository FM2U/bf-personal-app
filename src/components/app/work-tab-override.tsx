"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

/**
 * A page can say which Work menu item it belongs to when its address does not (push D): a listing opens at
 * /work/deals/<id> but belongs to Screen listings, so the menu shows Screen listings as the current page there. The
 * page renders <WorkTabOverride href="/work/listings" />; the left menu and the top menu row read it for that address
 * only, and it is gone once the page is left.
 */
type Override = { path: string; href: string } | null;
let current: Override = null;
const listeners = new Set<() => void>();
const set = (v: Override) => {
  current = v;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function WorkTabOverride({ href }: { href: string }) {
  const path = usePathname();
  useEffect(() => {
    set({ path, href });
    return () => set(null);
  }, [path, href]);
  return null;
}

/** The Work menu item the current page set for itself, or null (the address decides). */
export function useWorkTabOverride(): string | null {
  const path = usePathname();
  const o = useSyncExternalStore(subscribe, () => current, () => null);
  return o && o.path === path ? o.href : null;
}
