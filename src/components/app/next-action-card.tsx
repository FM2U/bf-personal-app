import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DueWord } from "@/components/ui/badge";
import { STATUS_TEXT, dueStatus } from "@/lib/status";
import { date as fmtDateOnly } from "@/lib/format";
import type { NextAction } from "@/lib/next-action";
import { cn } from "@/lib/utils";

/**
 * The record's next required action. Shown first on every record page: cobalt line on the left, light cobalt tint,
 * the action in larger semibold text, and its due date with "Overdue" (red) or "Due today" (amber).
 * Nothing left to do (tone "done"): a gray line on a white card.
 */
export function NextActionCard({ action, today, compact = false }: { action: NextAction; today: string; compact?: boolean }) {
  const done = action.tone === "done";
  const status = action.due ? dueStatus(action.due, today) : "neutral";
  return (
    <Card id="next-action" className={cn("relative overflow-hidden", done ? "bg-card" : "border-action-stripe/25 bg-action-bg")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", done ? "bg-status-neutral-solid" : "bg-action-stripe")} />
      <CardHeader className={cn("gap-1.5", compact && "p-4 pb-3")}>
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-600">Next required action</CardDescription>
        <CardTitle className={cn(compact ? "text-base" : "text-lg", "font-semibold leading-snug", done ? "text-slate-700" : "text-slate-900")}>{action.text}</CardTitle>
        {action.due ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <CalendarClock aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
            <span className={cn("tabular", status === "neutral" ? "text-slate-700" : cn(STATUS_TEXT[status], "font-medium"))}>Due {fmtDateOnly(action.due)}</span>
            <DueWord due={action.due} today={today} />
          </p>
        ) : null}
      </CardHeader>
      {action.href ? (
        <CardContent className={cn(compact && "px-4 pb-4")}>
          <Button asChild size="sm" variant={action.tone === "overdue" || status === "missed" ? "default" : "outline"} className={cn(action.tone !== "overdue" && status !== "missed" && "bg-white")}>
            {/* An address with a window (for example Resolve: ?w=r/commitments/<id>/resolve) opens that window over the current page. */}
            <Link href={action.href} data-window={windowOf(action.href)} data-testid="next-action-link">
              {action.linkText ?? "Open"} <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** The `w` value of an in-app address, if it names a window. */
function windowOf(href: string): string | undefined {
  if (!href.startsWith("/")) return undefined;
  try {
    return new URL(href, "http://localhost").searchParams.get("w") ?? undefined;
  } catch {
    return undefined;
  }
}
