import { ItemPage } from "@/components/app/work/item/page";

export const metadata = { title: "Opportunity" };

/** The opportunity page (/work/jobs/[id]) under the record-page rule (batch B2): Next action and Tasks first, then What to find out (2026-11-07). */
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemPage kind="job" id={id} />;
}
