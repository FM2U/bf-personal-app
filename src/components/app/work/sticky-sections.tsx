"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps a list of section headings that stay at the top while their section scrolls by (desktop). It measures what is
 * already pinned above the list (the page's pinned block, or the card's pinned title row) and sets --section-top, so
 * a pinned heading sits right under it instead of behind it. On phones nothing above is pinned, so the value is 0.
 */
export function StickySections({ under, children, className }: { under: "page" | "card"; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pinned = under === "page" ? document.querySelector<HTMLElement>('[data-pinned="page"]') : el.closest("section")?.querySelector<HTMLElement>('[data-pinned="card"]');
    const wide = window.matchMedia("(min-width: 1024px)");
    const set = () => el.style.setProperty("--section-top", `${pinned && wide.matches ? pinned.getBoundingClientRect().height : 0}px`);
    set();
    const ro = pinned ? new ResizeObserver(set) : null;
    if (pinned && ro) ro.observe(pinned);
    wide.addEventListener("change", set);
    return () => {
      ro?.disconnect();
      wide.removeEventListener("change", set);
    };
  }, [under]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
