import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Who is signed in, as checked here for this request (read by requireOwner in src/lib/auth.ts). */
const OWNER_HEADER = "x-bf-owner";
/** Marks a page build (not saving, not an API route); src/lib/kept-settings.ts has the same name. */
const PAGE_HEADER = "x-bf-page";

const PUBLIC_PATHS = ["/login", "/signup", "/report/", "/api/report/", "/api/cron/", "/manifest.webmanifest", "/icons/", "/sw.js"];

/** Refreshes the sign-in session on every request and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const t0 = performance.now();
  // One sign-in check per click (speed plan, 2026-11-07): getClaims confirms the session the same way as before (it asks
  // Supabase, or checks the signature itself when the project signs with a published key) and holds the email and the
  // second-step level, so the page no longer asks Supabase again (src/lib/auth.ts reads OWNER_HEADER).
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const signInMs = performance.now() - t0;
  const data = { user: claims?.sub ? { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null, aal: typeof claims.aal === "string" ? claims.aal : null } : null };
  // The page reads who is signed in from this header. Any header of that name sent by a browser is removed first, so
  // only this check can set it. Database reads still go out with the person's own session, so its rules still apply.
  const forwarded = new Headers(request.headers);
  forwarded.delete(OWNER_HEADER);
  if (data.user) forwarded.set(OWNER_HEADER, JSON.stringify(data.user));
  // Page builds may use the settings kept in the browser (src/lib/kept-settings.ts); saving and API routes never do.
  forwarded.delete(PAGE_HEADER);
  if (request.method === "GET" && !path.startsWith("/api/") && !request.headers.get("next-action")) forwarded.set(PAGE_HEADER, "1");
  const refreshed = response;
  response = NextResponse.next({ request: { headers: forwarded } });
  refreshed.cookies.getAll().forEach((c) => response.cookies.set(c));
  if (!data.user && !isPublic && path !== "/mfa") {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  // Page speed (2026-11-06), preview only: how long this sign-in check took, read by the speed line in the browser.
  if (process.env.VERCEL_ENV === "preview" || process.env.SHOW_TIMING === "1") response.headers.set("Server-Timing", `signin;dur=${signInMs.toFixed(1)}`);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
