import { PlaceholderWorkPage } from "@/components/app/work/placeholder-page";

export const metadata = { title: "Rosara" };

/** Rosara (batch B2): the weekly focus and one row per project. In batch B1 the page holds its place in the menu. */
export default function RosaraPage() {
  return <PlaceholderWorkPage title="Rosara" testId="work-rosara" what="The weekly focus and one row per project (name, milestone, next action with its due date, tasks). People you talk to for Rosara live on Outreach with the purpose Rosara." />;
}
