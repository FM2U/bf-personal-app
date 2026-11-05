"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps a list of section headings (bands) that stay at the top while their section scrolls by. It measures what is
 * already pinned above the list and sets --section-top, so a pinned band sits right under it instead of behind it:
 * the page's pinned block (desktop list pages), or the card's pinned title row when the card scrolls on its own
 * (desktop; `always`: at every width, for a card that scrolls on its own on the phone too, Waiting on someone). With
 * nothing pinned above, --section-top is left unset and the band sits under the slim pinned bar (--mini-h, 2026-11-04).
 */
export function StickySections({ under, children, className, always = false, media = "(min-width: 1024px)" }: { under: "page" | "card"; children: React.ReactNode; className?: string; always?: boolean; /** When the card or page above is pinned (Work on now: a desktop window tall enough). */ media?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pinned = under === "page" ? document.querySelector<HTMLElement>('[data-pinned="page"]') : el.closest("section")?.querySelector<HTMLElement>('[data-pinned="card"]');
    const wide = window.matchMedia(media);
    const set = () => {
      if (pinned && (wide.matches || always)) el.style.setProperty("--section-top", `${pinned.getBoundingClientRect().height - 1}px`);
      else el.style.removeProperty("--section-top");
    };
    set();
    const ro = pinned ? new ResizeObserver(set) : null;
    if (pinned && ro) ro.observe(pinned);
    wide.addEventListener("change", set);
    return () => {
      ro?.disconnect();
      wide.removeEventListener("change", set);
    };
  }, [under, always, media]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
