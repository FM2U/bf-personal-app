"use client";

import { usePathname, useRouter } from "next/navigation";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { saveReview } from "@/app/actions/domain";

/**
 * The review form. When the daily close cannot be completed (a missed item has no reason), the typed answers stay
 * and the same page (or the same window) lists the items that still need a reason (?missing=).
 */
export function ReviewForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <GuardedForm
      action={saveReview}
      className={className}
      onResult={(r) => {
        const missing = (r as { missing?: string } | null)?.missing;
        if (missing) router.replace(`${pathname}?missing=${encodeURIComponent(missing)}`, { scroll: false });
      }}
    >
      {children}
    </GuardedForm>
  );
}
