"use client";

import { useState } from "react";
import Link from "next/link";
import { Lightbulb, X } from "lucide-react";
import { openChat, type ChatContext } from "@/components/app/chat-bus";
import { openWindowView } from "@/components/app/window-host";
import { addDismissed, DISMISSED_COOKIE, type Suggestion } from "@/lib/suggestions";
import { parseWindowParam } from "@/lib/window-route";
import { cn } from "@/lib/utils";

function remember(key: string) {
  try {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${DISMISSED_COOKIE}=`))?.slice(DISMISSED_COOKIE.length + 1) ?? "";
    document.cookie = `${DISMISSED_COOKIE}=${addDismissed(raw, key)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  } catch {
    // Cookies blocked: the line is hidden for now and may show again on the next visit.
  }
}

/**
 * One suggestion line (at most one per page or window): a short line made from the app's own data and rules, with an
 * optional link and an optional AI button ("Suggest a next step" opens the AI chat about the record). Dismiss hides it
 * and remembers that in this browser (cookie), so it stays hidden until the situation changes (a new key).
 */
export function SuggestionLine({ s, context, className }: { s: Suggestion; context?: ChatContext; className?: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const win = s.link?.window ? parseWindowParam(s.link.window) : null;
  return (
    <div role="note" className={cn("flex items-start gap-2.5 rounded-lg border border-primary-border bg-primary-soft/70 px-3 py-2 text-sm", className)} data-testid="suggestion-line" data-key={s.key}>
      <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-slate-800">
        <span>{s.text}</span>
        {s.link ? (
          win ? (
            <button type="button" onClick={(e) => (e.currentTarget.closest("[data-url-window]") ? null : openWindowView(win))} className="ml-2 font-medium text-primary-strong hover:underline">
              {s.link.label}
            </button>
          ) : (
            <Link href={s.link.href} className="ml-2 font-medium text-primary-strong hover:underline">
              {s.link.label}
            </Link>
          )
        ) : null}
        {s.ai && context ? (
          <button
            type="button"
            onClick={(e) => openChat({ context, prompt: s.ai!.prompt, inWindow: !!e.currentTarget.closest("[data-app-window]") })}
            className="ml-2 font-medium text-primary-strong hover:underline"
            data-testid="suggestion-ai"
          >
            {s.ai.label}
          </button>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => {
          remember(s.key);
          setHidden(true);
        }}
        className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-900"
        aria-label="Dismiss this suggestion"
        data-testid="suggestion-dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
