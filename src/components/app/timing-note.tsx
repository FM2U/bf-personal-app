"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The page speed line (preview only, 2026-11-06). The numbers describe the full page load they came with; after a
 * click to another page the line asks for a browser reload instead of showing the old numbers.
 */
export function TimingNote({ text }: { text: string }) {
  const path = usePathname();
  const [first] = useState(path);
  return (
    <p className="no-print mt-10 text-center text-[11.5px] text-slate-400 tabular-nums" data-testid="timing-line" data-fresh={path === first ? "1" : "0"}>
      {path === first ? text : "Speed line: reload the browser page (Command+R) to measure this page."}
    </p>
  );
}
