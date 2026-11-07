"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { checkRepliesNow } from "@/app/actions/replies";

/**
 * Looks for new email replies once the page is on screen (page speed, 2026-11-06); when any came in, the page reads
 * its data again so they show. Draws nothing.
 */
export function ReplyCheck() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    checkRepliesNow()
      .then((r) => {
        if (r.added > 0) router.refresh();
      })
      .catch(() => {});
  }, [router]);
  return null;
}
