"use client";

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openChat, type ChatContext } from "@/components/app/chat-bus";
import { cn } from "@/lib/utils";

/**
 * "Ask AI about this": opens the AI chat with this page or record as its subject. In a window the chat opens inside
 * the window. The AI reads the data and only proposes changes; nothing is saved until the owner approves.
 */
export function AskAiButton({ context, prompt, label = "Ask AI about this", compact = false, className }: { context: ChatContext; prompt?: string; label?: string; compact?: boolean; className?: string }) {
  const path = usePathname();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("no-print border-primary-border text-primary-strong hover:bg-primary-soft", compact && "px-2 sm:px-3", className)}
      onClick={(e) => openChat({ context: { ...context, path: context.path ?? path }, prompt, inWindow: !!e.currentTarget.closest("[data-app-window]") })}
      data-testid="ask-ai"
      aria-label={compact ? label : undefined}
    >
      <Sparkles className="text-gold" /> <span className={cn(compact && "hidden sm:inline")}>{label}</span>
    </Button>
  );
}
