"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A row that opens its record when clicked anywhere outside its buttons and links (Edit batch C round 3): the Home
 * next-action and waiting rows, the Outreach rows, the Rosara project rows, the Screen listings rows (which open the
 * listing popup). It carries the shared hover class (.row-hover in globals.css). Keyboard: the row is reached with
 * Tab and Enter opens it; its own buttons and links keep their own Tab stops. A click on a button, a link, a field, a
 * menu, or an inline confirmation line (data-row-stop) does nothing here, and neither does a click inside a window
 * opened from the row (a portal is not inside the row on the page). Ctrl or Cmd and click opens a new tab.
 */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=menu],[role=menuitem],[role=dialog],[data-row-stop]";

export function rowClickOpens(e: { target: EventTarget | null; currentTarget: HTMLElement }): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !e.currentTarget.contains(t)) return false;
  const hit = t.closest(INTERACTIVE);
  if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return false;
  // Selecting text in a row is not a click to open it.
  const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
  if (sel && !sel.isCollapsed && sel.toString().trim()) return false;
  return true;
}

export function OpenRow({ href, onOpen, label, className, children, testId, dataAttrs }: { href?: string; onOpen?: () => void; /** What the row opens, read out to a screen reader ("Open Dalton Services"). */ label?: string; className?: string; children: React.ReactNode; testId?: string; dataAttrs?: Record<string, string> }) {
  const router = useRouter();
  const open = (newTab = false) => {
    if (onOpen) return onOpen();
    if (!href) return;
    if (newTab) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  return (
    <div
      role={onOpen ? "button" : "link"}
      tabIndex={0}
      aria-label={label}
      aria-haspopup={onOpen ? "dialog" : undefined}
      className={cn("row-hover", className)}
      onClick={(e) => {
        if (e.defaultPrevented || !rowClickOpens(e)) return;
        open(!!href && !onOpen && (e.metaKey || e.ctrlKey));
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || (onOpen && e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      data-testid={testId}
      data-open={href ?? "popup"}
      {...dataAttrs}
    >
      {children}
    </div>
  );
}
