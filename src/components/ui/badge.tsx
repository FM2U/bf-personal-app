import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, STATUS_DOT, STATUS_TEXT, dueStatus, dueWord, type Status } from "@/lib/status";

/**
 * Badge colors: default = teal (app color, labels such as Proprietary); the rest are the four status colors
 * (success = met or done, warning = due soon or today, danger = missed or overdue, neutral = gray).
 */
const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/10 text-primary",
      neutral: STATUS_BADGE.neutral,
      success: STATUS_BADGE.met,
      warning: STATUS_BADGE.soon,
      danger: STATUS_BADGE.missed,
      outline: "border-border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A badge in one of the four status colors. */
export function StatusBadge({ status, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { status: Status }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_BADGE[status], className)} {...props} />;
}

/** A small round dot in a status color. */
export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status], className)} />;
}

/** Text in a status color (neutral keeps the surrounding text color). */
export function StatusText({ status, className, strong = true, ...props }: React.HTMLAttributes<HTMLSpanElement> & { status: Status; strong?: boolean }) {
  return <span className={cn(status !== "neutral" && STATUS_TEXT[status], status !== "neutral" && strong && "font-medium", className)} {...props} />;
}

/** Status of a due date as a text color class: overdue red, due today amber, otherwise none. */
export function dueClass(due: string | null | undefined, today: string, done = false): string {
  const s = dueStatus(due, today, { done: false });
  if (done || s === "neutral") return "";
  return cn(STATUS_TEXT[s], "font-medium");
}

/** "Overdue" or "Due today" in its status color, or nothing. */
export function DueWord({ due, today, className }: { due: string | null | undefined; today: string; className?: string }) {
  const w = dueWord(due, today);
  if (!w) return null;
  return <StatusBadge status={w === "Overdue" ? "missed" : "soon"} className={className}>{w}</StatusBadge>;
}
