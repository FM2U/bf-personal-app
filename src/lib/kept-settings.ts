import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { KeptWorkWeek } from "@/lib/work-week";

/**
 * Rarely-changing settings kept in the browser (speed plan, Bram 2026-11-07; claude/2026-11-07-speed-plan.md).
 *
 * A page needs a few settings before it can ask for its data: the time zone (for "today"), the waiting thresholds, the
 * End of day time, the Name in Settings, and the ids of the three pipelines. Reading them first costs a whole trip to
 * the database on every page. So the browser keeps them in a small cookie (KEPT_COOKIE), and a page build starts all
 * its reads at once with them.
 *
 * The page still reads the same settings in that same trip, and KeptSettingsCheck (src/components/app/kept-settings.tsx)
 * compares the two after the page is sent: when anything differs (a setting changed in another tab), the cookie is
 * corrected and the page is built again with the fresh settings. Without the cookie (the first visit), the page reads
 * the settings first, as before.
 *
 * Only page builds use the cookie (the proxy marks them, PAGE_HEADER). Saving (server actions) and API routes always
 * read the settings fresh from the database.
 */
export const KEPT_COOKIE = "bf_kept";
export const PAGE_HEADER = "x-bf-page";

export type KeptSettings = {
  /** The owner the settings belong to. */
  o: string;
  tz: string;
  /** Waiting threshold days, End of day time (HH:MM), no-reply days. */
  th: number;
  eod: string;
  nr: number;
  /** The Name in Settings (display_name), or null. */
  dn: string | null;
  /** The pipeline ids by kind (acquisition, job, consulting); null when there is none. */
  p: { a: string | null; j: string | null; c: string | null };
  /** The work week (design B, 2026-11-07): [work days, week start, review day], ISO day numbers. */
  ww?: KeptWorkWeek;
  /** Stalled after (days) or null, and Send automatically (2026-11-08). */
  st?: number | null;
  as?: boolean;
  /** Counting starts on (YYYY-MM-DD) or null (2026-11-09). */
  cs?: string | null;
};

export function encodeKept(k: KeptSettings): string {
  return Buffer.from(JSON.stringify(k)).toString("base64url");
}

function decodeKept(raw: string | undefined): KeptSettings | null {
  if (!raw) return null;
  try {
    const k = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as KeptSettings;
    const ok = typeof k.o === "string" && typeof k.tz === "string" && Number.isFinite(k.th) && typeof k.eod === "string" && Number.isFinite(k.nr) && (k.dn === null || typeof k.dn === "string") && !!k.p && typeof k.p === "object";
    return ok ? k : null;
  } catch {
    return null;
  }
}

/** The settings kept in the browser for this page build, or null (not a page build, no cookie, or another owner). */
export const keptSettings = cache(async (ownerId: string): Promise<KeptSettings | null> => {
  try {
    if ((await headers()).get(PAGE_HEADER) !== "1") return null;
    const k = decodeKept((await cookies()).get(KEPT_COOKIE)?.value);
    return k && k.o === ownerId ? k : null;
  } catch {
    return null;
  }
});

/** The cookie as it was sent with this page build (KeptSettingsCheck compares the fresh settings against it). */
export const keptCookieRaw = cache(async (): Promise<string | null> => {
  try {
    return (await cookies()).get(KEPT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
});

/**
 * Called by the saves that change a kept setting (Profile, Work settings, sample data): the cookie goes, so the next
 * page reads the settings fresh and keeps the new ones. Without this, that one page would show the old setting for a
 * moment before KeptSettingsCheck rebuilt it.
 */
export async function forgetKeptSettings(): Promise<void> {
  try {
    (await cookies()).delete(KEPT_COOKIE);
  } catch {
    // Not in a server action: nothing to do.
  }
}
