"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`;

// Kept outside the line itself, because some clicks (Work to Settings) build a new line: the click time and whether
// the full page load was already shown live for the whole visit.
let clickAt: number | null = null;
let fullLoadShown = false;
/** True the first time only: the line built by the full page load. */
function claimFullLoad(): boolean {
  // The server builds every line as a full load; only the browser keeps count over the visit.
  if (typeof window === "undefined") return true;
  const first = !fullLoadShown;
  fullLoadShown = true;
  return first;
}

/**
 * The page speed line (preview only, 2026-11-06).
 * - After a full page load (a reload, or a typed address): "Page drawn 0.85 s" (from the start of the load until the
 *   browser drew the page's main content), then the server numbers of that load.
 * - After a click on a link to another page: "Click to page 0.62 s" (from the click until the new page is drawn). The
 *   server numbers belong to the full load, so the line asks for a reload to see them for this page (also when the
 *   click builds a new line, as from Work to Settings: that line may still carry the earlier page's numbers).
 */
export function TimingNote({ text }: { text: string }) {
  const path = usePathname();
  const [first] = useState(path);
  const [drawn, setDrawn] = useState<number | null>(null);
  const [click, setClick] = useState<{ path: string; ms: number } | null>(null);
  // True only for the line built by the full page load; a line built after a click shows the click time instead.
  const [isFullLoad] = useState(claimFullLoad);

  // The full load: when the browser drew the largest piece of the page.
  useEffect(() => {
    if (!isFullLoad) return;
    try {
      const po = new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) setDrawn(last.startTime);
      });
      po.observe({ type: "largest-contentful-paint", buffered: true });
      return () => po.disconnect();
    } catch {
      return;
    }
  }, [isFullLoad]);

  // A plain click on a link to another page of the app starts the clock.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname === location.pathname) return;
      clickAt = performance.now();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page is on screen: stop the clock after the browser has drawn it.
  useEffect(() => {
    if ((path === first && isFullLoad) || clickAt === null) return;
    const t0 = clickAt;
    clickAt = null;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setClick({ path, ms: performance.now() - t0 }));
    });
    return () => cancelAnimationFrame(id);
  }, [path, first, isFullLoad]);

  const line =
    path === first && isFullLoad
      ? [drawn !== null ? `Page drawn ${secs(drawn)}` : null, text].filter(Boolean).join(" · ")
      : click && click.path === path
        ? `Click to page ${secs(click.ms)} · reload the browser page (Command+R) for the server numbers`
        : "Speed line: reload the browser page (Command+R) to measure this page.";
  return (
    <p className="no-print mt-10 text-center text-[11.5px] text-slate-400 tabular-nums" data-testid="timing-line" data-fresh={path === first ? "1" : "0"}>
      {line}
    </p>
  );
}
