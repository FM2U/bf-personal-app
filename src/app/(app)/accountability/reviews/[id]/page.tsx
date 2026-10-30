import { todayCloseRedirect } from "@/lib/review-today";
import { ReviewView } from "@/components/app/review-view";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ missing?: string }> }) {
  const id = await todayCloseRedirect((await params).id);
  return <ReviewView id={id} sp={await searchParams} />;
}
