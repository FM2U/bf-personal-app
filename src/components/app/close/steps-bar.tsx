import Link from "next/link";
import { CLOSE_STEPS, type CloseStep } from "@/lib/calc/today";
import { cn } from "@/lib/utils";

/** "1 Outcomes, 2 Changes, 3 Report" across the top of Close the day; the current step is cobalt, earlier steps are links. */
export function StepsBar({ current }: { current: CloseStep }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-gold-rule pb-3" data-testid="close-steps">
      {CLOSE_STEPS.map((s) => {
        const active = s.step === current;
        const done = s.step < current;
        const inner = (
          <>
            <span className={cn("tabular flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", active ? "bg-primary text-white" : done ? "bg-primary-soft text-primary-strong" : "bg-slate-100 text-slate-500")}>{s.step}</span>
            <span className={cn("text-sm", active ? "font-semibold text-primary-strong" : done ? "text-slate-700" : "text-slate-500")}>{s.label}</span>
          </>
        );
        return (
          <li key={s.step} aria-current={active ? "step" : undefined} data-testid={`close-step-${s.step}`} data-active={active ? "true" : undefined}>
            {done ? (
              <Link href={`/today/close?step=${s.step}`} className="flex items-center gap-2 hover:underline">
                {inner}
              </Link>
            ) : (
              <span className="flex items-center gap-2">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
