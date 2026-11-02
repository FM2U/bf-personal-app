import { requireOwner } from "@/lib/auth";
import { loadBuyBoxSettings } from "@/lib/work/buy-box-data";
import { PageHeader } from "@/components/app/page-header";
import { BuyBoxForm } from "@/components/app/buy-box-form";

export const metadata = { title: "Buy box" };

/**
 * Settings, Buy box (AI instructions revision 1, approved 2026-11-02): every part of the buy box is editable and saved
 * as a setting. Left card: the core and stretch ranges of EBITDA or SDE, owner-operator, and the line the AI reads.
 * Right card: industries included, excluded types, regions. The Fits check on Screen listings (Fits, Near fit,
 * Outside) and every AI action on a deal or a listing read these on each load or click.
 */
export default async function BuyBoxPage() {
  const { supabase, ownerId } = await requireOwner();
  const b = await loadBuyBoxSettings(supabase, ownerId);
  return (
    <div data-testid="buy-box-page">
      <PageHeader title="Buy box" description="What the Fits check on Screen listings and the AI judge every deal and listing against. A change here shows on the next page load and in the next AI answer." />
      <BuyBoxForm initial={b} />
    </div>
  );
}
