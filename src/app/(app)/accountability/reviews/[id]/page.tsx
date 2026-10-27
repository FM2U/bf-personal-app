import { ReviewView } from "@/components/app/review-view";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ missing?: string }> }) {
  const { id } = await params;
  return <ReviewView id={id} sp={await searchParams} />;
}
