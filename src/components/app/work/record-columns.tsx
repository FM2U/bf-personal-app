"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The two columns of a record page (Push B edits, 2026-11-03): the columns never scroll on their own; the page
 * scrolls. When the left column is the shorter one and fits on the screen under the slim pinned bar, it stays in place
 * (position: sticky) while the longer right column scrolls past it. When it does not fit, or on narrow screens where
 * the columns stack, it is in the normal flow.
 */
export function RecordColumns({ left, right, testId = "record-columns" }: { left: React.ReactNode; right: React.ReactNode; testId?: string }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState<{ on: boolean; top: number }>({ on: false, top: 0 });
  useEffect(() => {
    const measure = () => {
      const l = leftRef.current;
      const r = rightRef.current;
      if (!l || !r) return;
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      const header = document.querySelector<HTMLElement>("[data-slim-bar]");
      const top = (header?.offsetHeight ?? 0) + 16;
      const on = wide && l.offsetHeight < r.offsetHeight && l.offsetHeight + top + 16 <= window.innerHeight;
      setPin((p) => (p.on === on && p.top === top ? p : { on, top }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (leftRef.current) ro.observe(leftRef.current);
    if (rightRef.current) ro.observe(rightRef.current);
    const header = document.querySelector<HTMLElement>("[data-slim-bar]");
    if (header) ro.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div className="grid grid-cols-1 items-start gap-5 min-[1000px]:grid-cols-2" data-testid={testId}>
      <div ref={leftRef} className={cn("flex min-w-0 flex-col gap-5", pin.on && "sticky")} style={pin.on ? { top: pin.top } : undefined} data-testid="record-left" data-pinned-column={pin.on ? "1" : "0"}>
        {left}
      </div>
      <div ref={rightRef} className="flex min-w-0 flex-col gap-5" data-testid="record-right">
        {right}
      </div>
    </div>
  );
}
