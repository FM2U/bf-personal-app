import "server-only";
import { cookies } from "next/headers";
import { DISMISSED_COOKIE, parseDismissed, pickSuggestion, type Suggestion } from "@/lib/suggestions";

/** The suggestion keys dismissed in this browser. */
export async function dismissedSuggestions(): Promise<string[]> {
  try {
    return parseDismissed((await cookies()).get(DISMISSED_COOKIE)?.value);
  } catch {
    return [];
  }
}

/** The first suggestion that was not dismissed in this browser (null when none is left). */
export async function firstSuggestion(list: (Suggestion | null | undefined)[]): Promise<Suggestion | null> {
  return pickSuggestion(list, await dismissedSuggestions());
}
