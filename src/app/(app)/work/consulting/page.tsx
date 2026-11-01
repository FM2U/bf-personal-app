import { PlaceholderWorkPage } from "@/components/app/work/placeholder-page";

export const metadata = { title: "Consulting" };

/** Consulting (batch B2): the stages Lead, Proposal, Engagement, Paid with the fee at the right. In batch B1 the page holds its place in the menu. */
export default function ConsultingPage() {
  return <PlaceholderWorkPage title="Consulting" testId="work-consulting" what="Leads, proposals, engagements, and paid work, each with its fee, next action, and due date. Clients live on Outreach with the purpose Consulting." />;
}
