import { requireOwner } from "@/lib/auth";
import { ReviewView, reviewTitle } from "@/components/app/review-view";
import { RouteWindow } from "@/components/app/route-window";

/**
 * A review opened from inside the app (Home, Accountability, the evening "Complete the daily close" task) shows in
 * the large centered window over the current page. The full page stays at the same address (refresh or a shared link).
 */
export default async function ReviewWindow({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ missing?: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOwner();
  const { data: review } = await supabase.from("reviews").select("kind,period_start,period_end").eq("id", id).maybeSingle();
  return (
    <RouteWindow title={review ? reviewTitle(review) : "Review"} fullPageHref={`/accountability/reviews/${id}`}>
      <ReviewView id={id} sp={await searchParams} inWindow />
    </RouteWindow>
  );
}
