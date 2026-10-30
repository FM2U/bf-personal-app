import Link from "next/link";
import { Button } from "@/components/ui/button";
import { reopenDay } from "@/app/actions/today";
import { cn } from "@/lib/utils";

/**
 * The one button of the evening: "Close the day" (cobalt) opens the 3-step close. After the close is finished it
 * becomes a gray "Day closed" label with a Reopen link. On weekends the bottom button still opens the close.
 */
export function CloseDayButton({ state, step, size = "default", className }: { state: "open" | "closed" | "weekend"; step: number; size?: "default" | "sm"; className?: string }) {
  if (state === "closed") {
    return (
      <span className={cn("inline-flex items-center gap-3 text-sm", className)} data-testid="day-closed">
        <span className="rounded-md bg-slate-100 px-3 py-1.5 font-medium text-slate-600">Day closed</span>
        <form action={reopenDay}>
          <button type="submit" className="text-xs font-medium text-primary-strong hover:underline" data-testid="day-reopen">
            Reopen
          </button>
        </form>
      </span>
    );
  }
  return (
    <Button asChild size={size} className={className} data-testid="close-day">
      <Link href={`/today/close?step=${step}`}>Close the day</Link>
    </Button>
  );
}
