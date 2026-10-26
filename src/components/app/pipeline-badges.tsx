import { Badge } from "@/components/ui/badge";
import type { ItemStatus } from "@/lib/pipeline";

/** "Proprietary" (off-market) or "Brokered" badge for an acquisition item. */
export function DealSourceBadge({ type, showUnset = false }: { type: string | null | undefined; showUnset?: boolean }) {
  if (type === "proprietary")
    return (
      <Badge variant="default" title="Off-market deal found directly">
        Proprietary
      </Badge>
    );
  if (type === "brokered") return <Badge variant="neutral">Brokered</Badge>;
  return showUnset ? <span className="text-xs text-muted-foreground">Not set</span> : null;
}

/** Stalled and over-time-limit badges for an open pipeline item. */
export function ItemStatusBadges({
  status,
  itemStatus,
  fallback = false,
  nextActionOverdue = false,
}: {
  status: ItemStatus | undefined;
  itemStatus: string;
  fallback?: boolean;
  nextActionOverdue?: boolean;
}) {
  if (itemStatus !== "open") return fallback ? <span className="text-xs text-muted-foreground">{itemStatus === "won" ? "Closed, won" : "Passed"}</span> : null;
  const badges = [];
  if (nextActionOverdue)
    badges.push(
      <Badge key="overdue" variant="danger">
        Next action overdue
      </Badge>,
    );
  if (status?.limit?.over)
    badges.push(
      <Badge key="limit" variant="danger" title={`Day ${status.limit.daysInStage}; the stage time limit is ${status.limit.limit} days`}>
        Over time limit
      </Badge>,
    );
  if (status?.stalled)
    badges.push(
      <Badge key="stalled" variant="warning" title={`No stage change or activity for ${status.daysSinceActivity} days`}>
        Stalled
      </Badge>,
    );
  if (!badges.length) return fallback ? <span className="text-xs text-muted-foreground">None</span> : null;
  return <span className="flex flex-wrap gap-1">{badges}</span>;
}
