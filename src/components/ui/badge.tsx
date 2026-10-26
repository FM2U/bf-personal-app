import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/10 text-primary",
      neutral: "border-transparent bg-muted text-muted-foreground",
      success: "border-transparent bg-emerald-50 text-emerald-700",
      warning: "border-transparent bg-amber-50 text-amber-800",
      danger: "border-transparent bg-red-50 text-red-700",
      outline: "border-border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
