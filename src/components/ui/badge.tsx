import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, STATUS_TEXT, type Status } from "@/lib/status";

/**
 * Badge colors: default = cobalt (app color, labels such as Commitment); soft = soft blue with its edge (Proprietary);
 * the rest are the four status colors (success = met or done, warning = due soon or today, danger = missed or overdue, neutral = gray).
 */
const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-primary-soft text-primary-strong",
      soft: "border-primary-border bg-primary-soft text-primary-strong",
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


/** Text in a status color (neutral keeps the surrounding text color). */
export function StatusText({ status, className, strong = true, ...props }: React.HTMLAttributes<HTMLSpanElement> & { status: Status; strong?: boolean }) {
  return <span className={cn(status !== "neutral" && STATUS_TEXT[status], status !== "neutral" && strong && "font-medium", className)} {...props} />;
}
