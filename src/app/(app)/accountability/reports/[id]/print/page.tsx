import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { activeLinkFor, reportText } from "@/lib/engine/partners";
import { PrintButton } from "./print-button";

export default async function PrintLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOwner();
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", id).maybeSingle();
  if (!report) notFound();
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).single();
  if (!partner) notFound();
  const link = await activeLinkFor({ sb: supabase }, partner.id);
  const letter = reportText(partner, report, link, "mail");
  return (
    <div className="mx-auto max-w-2xl rounded-lg bg-white p-10 shadow-sm print:shadow-none">
      <div className="no-print mb-6">
        <PrintButton />
      </div>
      {partner.mailing_address ? <p className="mb-8 whitespace-pre-wrap text-sm">{partner.mailing_address}</p> : null}
      <p className="mb-6 text-sm">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
      <div className="whitespace-pre-wrap font-serif text-[15px] leading-7">{letter.body}</div>
    </div>
  );
}
