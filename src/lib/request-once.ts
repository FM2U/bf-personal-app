import "server-only";
import { cache } from "react";

/**
 * Page speed (2026-11-06): one read per page build for data many parts of a page ask for (the profile, the settings,
 * a pipeline with its stages, the Google connection, the sign-in check). The first caller's read is shared by every
 * later caller while the same page is being built; the next page build reads again. Outside a page build (a server
 * action, a scheduled job) nothing is shared, so every call reads fresh, as before.
 */
const pageStore = cache(() => new Map<string, Promise<unknown>>());

export function oncePerPage<T>(key: string, load: () => PromiseLike<T>): Promise<T> {
  let store: Map<string, Promise<unknown>>;
  try {
    store = pageStore();
  } catch {
    return Promise.resolve(load());
  }
  let p = store.get(key) as Promise<T> | undefined;
  if (!p) {
    p = Promise.resolve(load());
    store.set(key, p);
  }
  return p;
}
