import { Briefcase, CheckSquare, Home, Scale, Settings, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One small line icon per module, used in the sidebar and on card titles that belong to a module. */
export const MODULE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  plan: Target,
  finance: Wallet,
  opportunities: Briefcase,
  people: Users,
  productivity: CheckSquare,
  accountability: Scale,
  settings: Settings,
};

export type ModuleKey = keyof typeof MODULE_ICONS;

/** 16px gray line icon for a module (decorative: the title next to it says what it is). */
export function ModuleIcon({ module, className }: { module: ModuleKey; className?: string }) {
  const Icon = MODULE_ICONS[module];
  if (!Icon) return null;
  return <Icon aria-hidden className={cn("h-4 w-4 shrink-0 text-slate-400", className)} strokeWidth={1.75} />;
}

/** A card title (or label) with its module icon in front, centered on the first line of text. */
export function ModuleTitle({ module, children, className }: { module: ModuleKey; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <ModuleIcon module={module} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}
