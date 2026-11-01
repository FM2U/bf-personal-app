import { ItemPage } from "@/components/app/work/item/page";

export const metadata = { title: "Consulting" };

/** The consulting page (/work/consulting/[id]) under the record-page rule (batch B2): scope, fee, start date, status in Facts. */
export default async function ConsultingItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemPage kind="consulting" id={id} />;
}
