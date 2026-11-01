"use client";

import { useState } from "react";
import { Drawer } from "@/components/app/work/drawer";
import { cn } from "@/lib/utils";

/**
 * The Ask AI element (approved 2026-10-31, decisions on v2 and v3): a pill like the filter pills, a little taller,
 * the normal text color, with a small bold four-point star in purple before the words. The purple star is the one
 * mark that means AI. In batch B1 it opens a small panel that says the panel comes with the next update (batch B2
 * builds it), so every page header already has its final layout.
 */
export function AiStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-[13px] w-[13px] shrink-0 text-violet", className)} aria-hidden>
      <path d="M8 0.5 C8.6 4.4 9.9 6.4 15.5 8 C9.9 9.6 8.6 11.6 8 15.5 C7.4 11.6 6.1 9.6 0.5 8 C6.1 6.4 7.4 4.4 8 0.5 Z" fill="currentColor" />
    </svg>
  );
}

export function AskAiPill({ context, className }: { /** What the panel would read ("Outreach, 16 people"). */ context?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-[34px] items-center gap-1.5 rounded-full border border-border bg-white px-3.5 text-[13px] font-medium whitespace-nowrap text-slate-800 hover:bg-slate-50", className)} data-testid="ask-ai">
        <AiStar />
        Ask AI
      </button>
      <Drawer open={open} onOpenChange={setOpen} title="Ask AI" sub={context} testId="ask-ai-panel">
        <div className="rounded-lg border border-violet/30 bg-violet-soft px-4 py-3.5 text-[13.5px] text-slate-800" data-testid="ask-ai-note">
          <b className="font-semibold">Ask AI comes with the next update.</b>
          <p className="mt-1 text-[13px] text-slate-700">This panel will read the page you are on, suggest next steps, and answer questions about it. The pill stays here so nothing moves when it arrives.</p>
        </div>
      </Drawer>
    </>
  );
}
