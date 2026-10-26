import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { MobileModuleBar, SidebarLinks } from "@/components/app/nav-links";
import { AskAiSidebarButton, ChatPanel } from "@/components/app/chat-panel";
import { signOut } from "@/app/actions/auth";
import { isAIConfigured } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireOwner();
  const [{ count: pending }, { count: alerts }] = await Promise.all([
    supabase.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-white px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 px-3 text-base font-semibold tracking-tight text-slate-900">
          BF Personal App
        </Link>
        <SidebarLinks />
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <AskAiSidebarButton />
          <Link href="/proposals" className="flex items-center justify-between rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI proposals
            </span>
            {pending ? <span className="rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-800">{pending}</span> : null}
          </Link>
          <Link href="/#alerts" className="flex items-center justify-between rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
            <span>Alerts</span>
            {alerts ? <span className="rounded-full bg-red-100 px-2 text-xs font-medium text-red-800">{alerts}</span> : null}
          </Link>
          <form action={signOut}>
            <button className="w-full rounded-md px-3 py-2 text-left text-slate-500 hover:bg-slate-100">Sign out ({user.email})</button>
          </form>
        </div>
      </aside>
      <header className="no-print sticky top-0 z-30 border-b border-border bg-white/95 pt-3 backdrop-blur lg:hidden">
        <div className="mb-2 flex items-center justify-between px-4">
          <Link href="/" className="text-base font-semibold">
            BF Personal App
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/proposals" className="rounded-full border border-border px-2 py-1">
              Proposals{pending ? ` (${pending})` : ""}
            </Link>
            <Link href="/#alerts" className="rounded-full border border-border px-2 py-1">
              Alerts{alerts ? ` (${alerts})` : ""}
            </Link>
          </div>
        </div>
        <MobileModuleBar />
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-24 sm:px-6 lg:px-8">{children}</main>
      <ChatPanel aiReady={isAIConfigured()} />
    </div>
  );
}
