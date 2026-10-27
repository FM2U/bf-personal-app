"use client";

import { LayoutGrid } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { openWindowView } from "@/components/app/window-host";

/** "View summary" on an initiative page: opens the initiative's overview window; each line opens in the same window. */
export function ViewSummaryButton({ initiativeId, ...props }: ButtonProps & { initiativeId: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => openWindowView({ kind: "record", table: "initiatives", id: initiativeId })} {...props}>
      <LayoutGrid /> View summary
    </Button>
  );
}
