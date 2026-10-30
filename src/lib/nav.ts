import { getResource } from "@/lib/resources";
export type NavTab = { href: string; label: string };
export type NavModule = { key: string; label: string; href: string; icon: string; tabs: NavTab[] };

/**
 * The main menu (the focused version, 2026-10-30): five items. Today is the home screen. Pipelines opens the existing
 * pipelines area, Commitments and Reports open their existing pages, and More lists every other page.
 */
export const MAIN_NAV: NavModule[] = [
  { key: "today", label: "Today", href: "/", icon: "today", tabs: [] },
  { key: "pipelines", label: "Pipelines", href: "/opportunities", icon: "pipelines", tabs: [] },
  { key: "commitments", label: "Commitments", href: "/accountability", icon: "commitments", tabs: [] },
  { key: "reports", label: "Reports", href: "/accountability/reports", icon: "reports", tabs: [] },
  { key: "more", label: "More", href: "/more", icon: "more", tabs: [] },
];

/** The main menu item a path belongs to (for the active state in the menu). */
export function mainFor(path: string): NavModule {
  if (path === "/" || path.startsWith("/today")) return MAIN_NAV[0];
  if (path.startsWith("/accountability/reports") || path.startsWith("/records/partner_reports")) return MAIN_NAV[3];
  if (path === "/accountability" || path.startsWith("/accountability?") || path.startsWith("/records/commitments")) return MAIN_NAV[2];
  if (path.startsWith("/opportunities") || path.startsWith("/records/pipeline_items")) return MAIN_NAV[1];
  return MAIN_NAV[4];
}

/** Every page that is not on the main menu, listed on the More page (nothing was deleted; every old address still works). Ask AI is a button on that page. */
export const MORE_LINKS: { href: string; label: string; note: string }[] = [
  { href: "/finance", label: "Finance", note: "Accounts, balance sheet, expenses, budget, debt, funding, income, savings" },
  { href: "/plan/goals", label: "Goals and milestones", note: "Goals, milestones, decision conditions" },
  { href: "/plan/decisions", label: "Decisions", note: "The decisions log" },
  { href: "/plan", label: "Documents", note: "Plan documents and checklists are on each initiative; files are on each record" },
  { href: "/plan", label: "Plan", note: "Initiatives, inputs and assumptions, scenarios" },
  { href: "/productivity", label: "Productivity", note: "Tasks, calendar time blocks, recurring tasks, pipeline next actions" },
  { href: "/people/communications", label: "Communications", note: "Communication history and the Outreach Queue" },
  { href: "/people", label: "People", note: "Contacts and organizations" },
  { href: "/proposals", label: "Proposals", note: "AI proposals waiting for your approval" },
  { href: "/accountability/reviews", label: "Reviews (old)", note: "The old daily close, weekly, monthly, and quarterly reviews" },
  { href: "/accountability/targets", label: "Targets", note: "Daily and weekly targets" },
  { href: "/accountability/scores", label: "Scores", note: "Completion scores" },
  { href: "/accountability/partners", label: "Partners", note: "Accountability partners" },
  { href: "/accountability/report-templates", label: "Report templates", note: "Which measures a partner report shows" },
  { href: "/settings", label: "Settings", note: "Connections, email signature, AI, imports, sample data and reset, profile" },
  { href: "/more/old-home", label: "Old Home", note: "The previous home page with its tiles and cards" },
];

/** The old modules, kept for the sub-tabs of each old area (ModuleTabs). */
export const NAV: NavModule[] = [
  { key: "home", label: "Home", href: "/", icon: "home", tabs: [] },
  {
    key: "plan",
    label: "Plan",
    href: "/plan",
    icon: "target",
    tabs: [
      { href: "/plan", label: "Initiatives" },
      { href: "/plan/goals", label: "Goals" },
      { href: "/plan/milestones", label: "Milestones" },
      { href: "/plan/conditions", label: "Decision Conditions" },
      { href: "/plan/inputs", label: "Inputs and Assumptions" },
      { href: "/plan/scenarios", label: "Scenarios" },
      { href: "/plan/decisions", label: "Decisions Log" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    href: "/finance",
    icon: "wallet",
    tabs: [
      { href: "/finance", label: "Accounts and Cash" },
      { href: "/finance/balance-sheet", label: "Balance Sheet" },
      { href: "/finance/expenses", label: "Expenses" },
      { href: "/finance/import", label: "Import CSV" },
      { href: "/finance/budget", label: "Budget" },
      { href: "/finance/debt", label: "Debt" },
      { href: "/finance/funding", label: "Funding" },
      { href: "/finance/income", label: "Income Received" },
      { href: "/finance/savings", label: "Savings and Financial Security" },
    ],
  },
  { key: "opportunities", label: "Opportunities", href: "/opportunities", icon: "briefcase", tabs: [{ href: "/opportunities", label: "All pipelines" }] },
  {
    key: "people",
    label: "People",
    href: "/people",
    icon: "users",
    tabs: [
      { href: "/people", label: "Contacts" },
      { href: "/people/organizations", label: "Organizations" },
      { href: "/people/communications", label: "Communication history" },
      { href: "/people/outreach", label: "Outreach Queue" },
    ],
  },
  {
    key: "productivity",
    label: "Productivity",
    href: "/productivity",
    icon: "check",
    tabs: [
      { href: "/productivity", label: "Today's plan" },
      { href: "/productivity/tasks", label: "Task lists" },
      { href: "/productivity/recurring", label: "Recurring tasks" },
      { href: "/productivity/calendar", label: "Calendar time blocks" },
      { href: "/productivity/pipeline-actions", label: "Pipeline next actions" },
    ],
  },
  {
    key: "accountability",
    label: "Accountability",
    href: "/accountability",
    icon: "scale",
    tabs: [
      { href: "/accountability", label: "Commitments" },
      { href: "/accountability/targets", label: "Targets" },
      { href: "/accountability/reviews", label: "Reviews" },
      { href: "/accountability/scores", label: "Completion scores" },
      { href: "/accountability/partners", label: "Accountability partners" },
      { href: "/accountability/reports", label: "Partner reports" },
      { href: "/accountability/report-templates", label: "Report templates" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    tabs: [
      { href: "/settings", label: "Connections" },
      { href: "/settings/email", label: "Email signature" },
      { href: "/settings/ai", label: "AI usage and proposals" },
      { href: "/settings/imports", label: "Data imports" },
      { href: "/settings/partner-access", label: "Partner access" },
      { href: "/settings/initiatives", label: "Initiatives and pipelines" },
      { href: "/settings/categories", label: "Categories" },
      { href: "/settings/export", label: "Export" },
      { href: "/settings/data", label: "Sample data and reset" },
      { href: "/settings/profile", label: "Profile and security" },
      { href: "/settings/change-log", label: "Change log" },
    ],
  },
];

/** Which module a path belongs to. */
export function moduleFor(path: string): NavModule {
  if (path === "/") return NAV[0];
  const rec = path.match(/^\/records\/([a-z_]+)/);
  if (rec) {
    const r = getResource(rec[1]);
    if (r && r.listHref !== "/") return moduleFor(r.listHref);
  }
  if (path.startsWith("/proposals")) return NAV[NAV.length - 1];
  const hit = NAV.slice(1).find((m) => path === m.href || path.startsWith(`${m.href}/`));
  if (hit) return hit;
  if (path.startsWith("/more") || path.startsWith("/today")) return { key: "more", label: "More", href: "/more", icon: "more", tabs: [] };
  return NAV[0];
}
