import { PlaceholderWorkPage } from "@/components/app/work/placeholder-page";

export const metadata = { title: "Job search" };

/** Job search (batch B2): the Deals layout with the stages Contact, Conversation, Interview, Offer. In batch B1 the page holds its place in the menu. */
export default function JobSearchPage() {
  return <PlaceholderWorkPage title="Job search" testId="work-jobs" what="Opportunities in the stages Contact, Conversation, Interview, and Offer, each with its contact, next action, and due date. Recruiters and former colleagues live on Outreach with the purpose Job search." />;
}
