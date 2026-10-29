/**
 * The `w` parameter as the browser address shows it, read at once (browser only).
 *
 * Why not only useSearchParams: Next.js applies an address change made with history.pushState as a router action in
 * a transition, and its router handles one action at a time. While the page underneath is still reloading (after a
 * window closed with changes) or a link is still loading, the new `w` waited in that queue: the address already said
 * ?w=work but no window opened until the reload finished (or never, when it stalled). The window host and the chat
 * read the address from here instead; it changes as soon as the address does.
 */
import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { WINDOW_PARAM } from "@/lib/window-route";

const listeners = new Set<() => void>();

/** Tells the readers that the address changed (called right after pushState or replaceState). */
export function notifyAddressChanged() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

function readW(): string | null {
  return new URL(window.location.href).searchParams.get(WINDOW_PARAM);
}

/** The `w` parameter of the current address. */
export function useWindowParam(): string | null {
  const routerW = useSearchParams().get(WINDOW_PARAM);
  const path = usePathname();
  const w = useSyncExternalStore(subscribe, readW, () => routerW);
  // A Next.js navigation (a link, router.push, router.refresh) writes the address when it is shown: read it again then.
  useEffect(() => {
    notifyAddressChanged();
  }, [routerW, path]);
  return w;
}
