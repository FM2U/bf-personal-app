"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/** On a page under Settings (not Settings itself): the link back to Settings, above the page title. */
export function SettingsBack() {
  const path = usePathname();
  if (path === "/settings") return null;
  return (
    <div className="no-print mb-3">
      <Link href="/settings" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-strong hover:underline" data-testid="settings-back">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Settings
      </Link>
    </div>
  );
}
