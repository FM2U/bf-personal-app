"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { openReviewId } from "@/app/actions/domain";
import { cn } from "@/lib/utils";

/**
 * Opens a review (today's daily close, the latest weekly review, ...) in the large centered window over the current
 * page. The review is drafted first when there is none yet. `asLink` shows it as a text link (the evening task).
 */
export function OpenReviewButton({ kind, children, asLink = false, className, ...props }: ButtonProps & { kind: "daily" | "weekly" | "monthly" | "quarterly"; asLink?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = () =>
    start(async () => {
      const id = await openReviewId(kind);
      router.push(id ? `/accountability/reviews/${id}` : "/accountability/reviews");
    });
  if (asLink)
    return (
      <button type="button" onClick={open} disabled={pending} className={cn("text-left text-sm font-medium text-primary-strong hover:underline disabled:opacity-60", className)} data-testid={`open-review-${kind}`}>
        {children}
      </button>
    );
  return (
    <Button type="button" onClick={open} disabled={pending} className={className} data-testid={`open-review-${kind}`} {...props}>
      {pending ? "Opening..." : children}
    </Button>
  );
}
