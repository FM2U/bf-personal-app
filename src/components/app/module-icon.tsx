import { Briefcase, CheckSquare, Home, Mail, MoreHorizontal, Scale, Settings, Sun, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_TEXT, MODULE_ACCENT } from "@/lib/status";

/** One small line icon per module, used in the sidebar and on card titles that belong to a module. */
const MODULE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  plan: Target,
  finance: Wallet,
  opportunities: Briefcase,
  people: Users,
  productivity: CheckSquare,
  accountability: Scale,
  settings: Settings,
  // The main menu (the focused version and the Work module).
  work: Briefcase,
  today: Sun,
  pipelines: Briefcase,
  commitments: Scale,
  reports: Mail,
  more: MoreHorizontal,
};

type ModuleKey = keyof typeof MODULE_ICONS;

/**
 * 16px line icon for a module in the module's accent color (src/lib/status.ts MODULE_ACCENT: Plan and Accountability
 * violet, Finance sky, Opportunities coral, People cyan, Productivity cobalt, Home and Settings gray).
 * Decorative: the title next to it says what it is.
 */
export function ModuleIcon({ module, className }: { module: ModuleKey; className?: string }) {
  const Icon = MODULE_ICONS[module];
  if (!Icon) return null;
  return <Icon aria-hidden className={cn("h-4 w-4 shrink-0", ACCENT_TEXT[MODULE_ACCENT[module] ?? "gray"], className)} strokeWidth={1.75} />;
}
