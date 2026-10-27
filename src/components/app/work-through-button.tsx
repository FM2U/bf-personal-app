import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "Work through tasks": opens today's tasks one at a time in the window (Home Today card, Productivity). */
export function WorkThroughTasksButton({ count, variant = "default" }: { count: number; variant?: "default" | "outline" }) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link href="/productivity" data-window="work" data-testid="work-through-tasks">
        <ListChecks /> Work through tasks{count ? ` (${count})` : ""}
      </Link>
    </Button>
  );
}
