"use client";
import { useEffect } from "react";

/**
 * Remembers whether closed stages are shown on a pipeline, for this browser, so the next visit opens the same way.
 * The list or board view is not remembered: every pipeline opens in list view.
 */
export function RememberPipelineView({ closedCookie, showClosed }: { closedCookie: string; showClosed: boolean }) {
  useEffect(() => {
    try {
      document.cookie = `${closedCookie}=${showClosed ? "show" : "hide"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // Cookies blocked: the page still works with its defaults.
    }
  }, [closedCookie, showClosed]);
  return null;
}
