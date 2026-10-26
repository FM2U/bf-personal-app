import { requireOwner } from "@/lib/auth";
import { ModuleTabs } from "@/components/app/nav-links";
import type { Row } from "@/lib/types";

export default async function OpportunitiesLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("pipelines").select("id,name").eq("is_active", true).order("sort_order");
  return (
    <>
      <ModuleTabs extra={((data ?? []) as Row[]).map((p) => ({ href: `/opportunities/${p.id}`, label: p.name }))} />
      {children}
    </>
  );
}
