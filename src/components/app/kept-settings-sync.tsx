"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The cookie name in src/lib/kept-settings.ts (KEPT_COOKIE). */
const KEPT_COOKIE = "bf_kept";

/**
 * Keeps the fresh settings in the browser (speed plan, 2026-11-07), and builds the page again when it was built with
 * different ones (a setting changed in another tab). Shows nothing.
 */
export function KeptSettingsSync({ value, rebuild }: { value: string; rebuild: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const current = document.cookie.split("; ").find((c) => c.startsWith(`${KEPT_COOKIE}=`))?.slice(KEPT_COOKIE.length + 1) ?? null;
    if (current === value) return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${KEPT_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    if (rebuild) router.refresh();
    // Every render: a save may have removed the cookie (forgetKeptSettings) while this page stayed open.
  });
  return null;
}
