"use client";

import { LayoutGrid } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useAppWindow } from "@/components/app/window-host";
import type { InitiativeSummary } from "@/lib/initiative/summary";

/** "View summary" on an initiative page: opens the summary window; each line opens its record in the same window. */
export function ViewSummaryButton({ summary, ...props }: ButtonProps & { summary: InitiativeSummary }) {
  const win = useAppWindow();
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => win.openSummary(summary)} {...props}>
      <LayoutGrid /> View summary
    </Button>
  );
}
