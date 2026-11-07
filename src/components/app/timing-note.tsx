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
  // A full load: when the first byte of the page came back (2026-11-06); with "Server", it shows time spent before the
  // page's own build (Vercel starting up, the sign-in check before the page).
  const [answer, setAnswer] = useState<number | null>(null);
  const [click, setClick] = useState<{ path: string; ms: number; parts: string | null } | null>(null);
  // True only for the line built by the full page load; a line built after a click shows the click time instead.
  const [isFullLoad] = useState(claimFullLoad);

  // The full load: when the browser drew the largest piece of the page.
  useEffect(() => {
    if (!isFullLoad) return;
    try {
      const po = new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) setDrawn(last.startTime);
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (nav && nav.responseStart > 0) setAnswer(nav.responseStart - nav.startTime);
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
    // Room for every page's requests in the browser's timing list (it keeps 250 by default).
    try {
      performance.setResourceTimingBufferSize(3000);
    } catch {}
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page is on screen: stop the clock after the browser has drawn it.
  useEffect(() => {
    if (clickAt === null) return;
    const t0 = clickAt;
    clickAt = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        const ms = performance.now() - t0;
        setClick({ path, ms, parts: null });
        // 2026-11-06: split the click into the page data and the drawing, from the browser's own timing of the
        // page-data request (it may still be arriving, so look again for a few seconds).
        let tries = 0;
        const look = () => {
          const page = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) => e.startTime >= t0 - 5 && /[?&]_rsc=/.test(e.name)).at(-1);
          if (page && page.responseEnd > 0) {
            // "page data": from the click until the server finished sending the page (its reads stream in, so this
            // is mostly the server building the page); "drawing": the rest, the browser putting it on screen.
            const kb = page.encodedBodySize || page.transferSize;
            const dataMs = page.responseEnd - t0;
            const parts = [`page data ${secs(dataMs)}${kb ? ` (${Math.max(1, Math.round(kb / 1024))} KB)` : ""}`, `drawing ${secs(Math.max(0, ms - dataMs))}`].join(" · ");
            setClick({ path, ms, parts });
          } else if (tries++ < 20) timer = setTimeout(look, 250);
        };
        look();
      });
    });
    return () => {
      cancelAnimationFrame(id);
      if (timer) clearTimeout(timer);
    };
  }, [path, first, isFullLoad]);

  const line =
    // After any click the line shows click times only, also back on the page first loaded (2026-11-06).
    path === first && isFullLoad && !click
      ? [drawn !== null ? `Page drawn ${secs(drawn)}` : null, answer !== null ? `first answer ${secs(answer)}` : null, text].filter(Boolean).join(" · ")
      : click && click.path === path
        ? [`Click to page ${secs(click.ms)}`, click.parts, "reload the browser page (Command+R) for the server numbers"].filter(Boolean).join(" · ")
        : "Speed line: reload the browser page (Command+R) to measure this page.";
  return (
    <p className="no-print mt-10 text-center text-[11.5px] text-slate-400 tabular-nums" data-testid="timing-line" data-fresh={path === first ? "1" : "0"}>
      {line}
    </p>
  );
}
