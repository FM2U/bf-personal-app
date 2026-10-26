"use client";
import { useEffect } from "react";

/** Remembers the pipeline view (list or board) for this browser, so the next visit opens the same view. */
export function RememberPipelineView({ cookie, view }: { cookie: string; view: "list" | "board" }) {
  useEffect(() => {
    try {
      document.cookie = `${cookie}=${view}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // Cookies blocked: the page still works and opens in list view.
    }
  }, [cookie, view]);
  return null;
}
