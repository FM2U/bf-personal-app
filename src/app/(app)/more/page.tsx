import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { AskAiSidebarButton } from "@/components/app/chat-panel";
import { MORE_LINKS } from "@/lib/nav";

export const metadata = { title: "More" };

/**
 * More: every page that is not on the main menu (Finance, Plan, People, Settings, the old reviews, the old Home, and
 * the rest). Nothing was deleted; every old address still works.
 */
export default function MorePage() {
  return (
    <div className="mx-auto w-full max-w-[880px]">
      <PageHeader title="More" description="Everything else in the app. Every page still works at its old address." ask={false} />
      <div className="mb-4 max-w-xs">
        <AskAiSidebarButton />
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="more-links">
        {MORE_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-white px-4 py-3 hover:border-primary-border hover:bg-primary-soft/40">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{l.label}</span>
                <span className="clamp-1 block text-xs text-muted-foreground">{l.note}</span>
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
