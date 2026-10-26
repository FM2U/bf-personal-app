"use client";
import { useEffect } from "react";

/**
 * Remembers the pipeline view (list or board) and whether closed stages are shown, for this browser,
 * so the next visit opens the same way.
 */
export function RememberPipelineView({ cookie, view, closedCookie, showClosed }: { cookie: string; view: "list" | "board"; closedCookie?: string; showClosed?: boolean }) {
  useEffect(() => {
    try {
      const age = 60 * 60 * 24 * 365;
      document.cookie = `${cookie}=${view}; path=/; max-age=${age}; samesite=lax`;
      if (closedCookie) document.cookie = `${closedCookie}=${showClosed ? "show" : "hide"}; path=/; max-age=${age}; samesite=lax`;
    } catch {
      // Cookies blocked: the page still works with its defaults.
    }
  }, [cookie, view, closedCookie, showClosed]);
  return null;
}
