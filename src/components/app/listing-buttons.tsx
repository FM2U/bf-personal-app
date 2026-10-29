import { addTargetEntry, undoTargetEntry } from "@/app/actions/targets";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * +1, +5, and Undo last for a target counted by hand (Listings screened). One entry per press (+5 adds one entry of 5),
 * so Undo last removes the last press made today. With `note`, a one-line note box (optional) is saved with the entry.
 * Used on the target card, the Acquisitions page header, Home, and Productivity.
 */
export function CountButtons({
  targetId,
  back,
  note = false,
  label,
  className,
  stretch = false,
}: {
  targetId: string;
  back: string;
  note?: boolean;
  /** Names the target in each button's accessible name, for example "Listings screened". */
  label?: string;
  className?: string;
  /** Buttons share the width (small tiles). */
  stretch?: boolean;
}) {
  const aria = (s: string) => (label ? `${s} ${label}` : undefined);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="count-buttons">
      <GuardedForm action={addTargetEntry} className={cn("flex flex-wrap items-center gap-2", stretch && "flex-1 flex-nowrap")}>
        <input type="hidden" name="target_id" value={targetId} />
        <input type="hidden" name="back" value={back} />
        {note ? <Input name="note" maxLength={200} placeholder="Note (optional)" aria-label="Note (optional)" className="h-8 w-44" /> : null}
        <SubmitButton size="sm" name="count" value="1" pendingText="+1" aria-label={aria("Add 1 to")} className={cn(stretch && "flex-1")}>
          +1
        </SubmitButton>
        <SubmitButton size="sm" name="count" value="5" pendingText="+5" aria-label={aria("Add 5 to")} className={cn(stretch && "flex-1")}>
          +5
        </SubmitButton>
      </GuardedForm>
      <GuardedForm action={undoTargetEntry} className={cn(stretch && "flex-1")}>
        <input type="hidden" name="target_id" value={targetId} />
        <SubmitButton size="sm" variant="outline" pendingText="Undo last" aria-label={aria("Undo last entry on")} className={cn("whitespace-nowrap", stretch && "w-full")}>
          Undo last
        </SubmitButton>
      </GuardedForm>
    </div>
  );
}
