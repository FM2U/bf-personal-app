type NavTab = { href: string; label: string };
type NavModule = { key: string; label: string; href: string; icon: string; tabs: NavTab[] };

/**
 * The main menu of the final app (2026-11-02): Work, Accountability, Settings. Work opens on Home (headed
 * "Work on now"; "/" goes there). The old modules (Finance, Plan, More and the rest) were removed; they live in the
 * old-app-archive branch and the old database.
 */
export const MAIN_NAV: NavModule[] = [
  { key: "work", label: "Work", href: "/work", icon: "work", tabs: [] },
  { key: "accountability", label: "Accountability", href: "/work/targets", icon: "accountability", tabs: [] },
  { key: "settings", label: "Settings", href: "/settings", icon: "settings", tabs: [] },
];

/** The Accountability screens: Targets, End of day (with the 5:30, Sent, or Skipped badge), Reports. */
export const ACCOUNTABILITY_TABS: NavTab[] = [
  { href: "/work/targets", label: "Targets" },
  { href: "/work/end-of-day", label: "End of day" },
  { href: "/work/reports", label: "Reports" },
];

/** True for the three Accountability screens under /work. */
function isAccountabilityPath(path: string): boolean {
  return ACCOUNTABILITY_TABS.some((t) => path === t.href || path.startsWith(`${t.href}/`));
}

/** The Work tabs: Home, Screen listings, Deals, Contacts (Outreach renamed People in push B, Contacts in the push B edits), Rosara, Job search, Consulting, To-dos. */
export const WORK_TABS: NavTab[] = [
  { href: "/work", label: "Home" },
  { href: "/work/listings", label: "Screen listings" },
  { href: "/work/deals", label: "Deals" },
  { href: "/work/people", label: "Contacts" },
  { href: "/work/rosara", label: "Rosara" },
  { href: "/work/jobs", label: "Job search" },
  { href: "/work/consulting", label: "Consulting" },
  { href: "/work/todos", label: "To-dos" },
];

/** The Settings pages (rebuilt as one page in push D). */
const SETTINGS_TABS: NavTab[] = [
  { href: "/settings", label: "Connections" },
  { href: "/settings/email", label: "Email signature" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/buy-box", label: "Buy box" },
  { href: "/settings/export", label: "Export" },
  { href: "/settings/data", label: "Sample data" },
  { href: "/settings/profile", label: "Profile and security" },
];

/** The main menu item a path belongs to (for the active state in the menu). */
export function mainFor(path: string): NavModule {
  if (isAccountabilityPath(path)) return MAIN_NAV[1];
  if (path.startsWith("/settings")) return MAIN_NAV[2];
  return MAIN_NAV[0];
}

/** The Work tab a path belongs to (the deal page belongs to Deals, the person and organization pages to Contacts). */
export function workTabFor(path: string): NavTab | null {
  if (!path.startsWith("/work") || isAccountabilityPath(path)) return null;
  return [...WORK_TABS].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(`${t.href}/`)) ?? WORK_TABS[0];
}

/** The module a path belongs to, with its sub-tabs (only Settings has sub-tabs as a module). */
export function moduleFor(path: string): NavModule {
  if (path.startsWith("/settings")) return { ...MAIN_NAV[2], tabs: SETTINGS_TABS };
  return mainFor(path);
}
