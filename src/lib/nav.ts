import { getResource } from "@/lib/resources";
export type NavTab = { href: string; label: string };
export type NavModule = { key: string; label: string; href: string; icon: string; tabs: NavTab[] };

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
      { href: "/accountability/reviews", label: "Reviews" },
      { href: "/accountability/scores", label: "Completion scores" },
      { href: "/accountability/partners", label: "Accountability partners" },
      { href: "/accountability/reports", label: "Partner reports" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    tabs: [
      { href: "/settings", label: "Connections" },
      { href: "/settings/ai", label: "AI usage and proposals" },
      { href: "/settings/imports", label: "Data imports" },
      { href: "/settings/partner-access", label: "Partner access" },
      { href: "/settings/initiatives", label: "Initiatives and pipelines" },
      { href: "/settings/categories", label: "Categories" },
      { href: "/settings/export", label: "Export" },
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
  return NAV[0];
}
