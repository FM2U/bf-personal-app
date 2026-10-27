"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { WindowFrame } from "@/components/ui/window";
import { Button } from "@/components/ui/button";
import { AskAiButton } from "@/components/app/ask-ai-button";

/**
 * The large centered window for a page opened from inside the app (the daily close and the other reviews).
 * Close (or Escape, or a click outside) goes back to the page underneath. "Open full page" shows the same page alone.
 */
export function RouteWindow({ title, fullPageHref, children }: { title: string; fullPageHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const review = fullPageHref.match(/^\/accountability\/reviews\/([0-9a-f-]{36})/);
  return (
    <WindowFrame
      open
      onOpenChange={(o) => {
        if (!o) router.back();
      }}
      size="large"
      title={title}
      testId="work-window"
      ask={<AskAiButton compact context={review ? { table: "reviews", id: review[1], label: title } : { label: title }} />}
      headerActions={
        <Button asChild variant="ghost" size="sm">
          <a href={fullPageHref} data-full-page="">
            Open full page <ArrowUpRight />
          </a>
        </Button>
      }
    >
      {children}
      <p className="mt-4 text-xs text-muted-foreground sm:hidden">
        <a href={fullPageHref} className="underline">Open full page</a>
      </p>
    </WindowFrame>
  );
}
