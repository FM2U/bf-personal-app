import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadBuyBoxSettings } from "@/lib/work/buy-box-data";
import { buyBoxLine } from "@/lib/ai/instructions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailGrid, PageHeader } from "@/components/app/page-header";
import { BuyBoxForm } from "@/components/app/buy-box-form";

export const metadata = { title: "Buy box" };

/**
 * Settings, Buy box (AI instructions, approved 2026-11-02). Left: the size range, industries, and regions (set in the
 * app; the Fits check on Screen listings uses them) and the line the AI reads. Right: owner-operator, financing, and
 * growth goals, saved as settings. Every AI action on a deal or a listing reads the buy box on each click.
 */
export default async function BuyBoxPage() {
  const { supabase, ownerId } = await requireOwner();
  const b = await loadBuyBoxSettings(supabase, ownerId);
  return (
    <div data-testid="buy-box-page">
      <PageHeader title="Buy box" description="What the AI judges every deal and listing against. The AI reads this on every click, so a change here shows in the next answer." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Size, industries, regions</CardTitle>
            <CardDescription>
              Set in the app. The Fits check on <Link href="/work/listings" className="underline">Screen listings</Link> uses them too.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailGrid
              items={[
                { label: "Size range", value: b.sizeRange },
                { label: "Industries", value: b.industries },
                { label: "Regions", value: b.regions },
              ]}
            />
            <div className="rounded-lg border border-violet-rule bg-violet-soft px-3.5 py-2.5" data-testid="buy-box-line">
              <span className="block text-xs font-medium text-muted-foreground">What the AI reads</span>
              <p className="mt-1 text-[13px] text-slate-800">{buyBoxLine(b)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Owner-operator, financing, growth goals</CardTitle>
            <CardDescription>Financing and growth goals are optional; the AI leaves out what is empty.</CardDescription>
          </CardHeader>
          <CardContent>
            <BuyBoxForm initial={{ ownerOperator: b.ownerOperator, financing: b.financing ?? "", growthGoals: b.growthGoals ?? "" }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
