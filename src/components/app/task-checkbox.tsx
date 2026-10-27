"use client";

import { useOptimistic, useTransition } from "react";
import { setTaskStatus } from "@/app/actions/records";

/** Completion checkbox for a task. Saves immediately. */
export function TaskCheckbox({ id, done, label }: { id: string; done: boolean; label: string }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <input
      type="checkbox"
      checked={optimistic}
      aria-label={`Mark "${label}" ${optimistic ? "not done" : "done"}`}
      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
      onChange={(e) => {
        const next = e.target.checked;
        start(async () => {
          setOptimistic(next);
          await setTaskStatus(id, next);
        });
      }}
    />
  );
}
