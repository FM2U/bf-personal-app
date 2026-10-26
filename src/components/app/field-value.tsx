import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { date, dateTime, money, num, pct } from "@/lib/format";
import { recordHref, type Field } from "@/lib/resources";
import { metricLabel } from "@/lib/metrics-list";
import { OPERATOR_LABELS, type Operator } from "@/lib/calc/conditions";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "default"> = {
  done: "success", met: "success", completed: "success", won: "success", connected: "success", received: "success", decided: "success", finalized: "success", active: "default",
  todo: "neutral", open: "default", planned: "neutral", draft: "warning", pending: "warning", chosen: "default", in_progress: "default", offered: "neutral", review: "warning",
  missed: "danger", lost: "danger", error: "danger", dropped: "neutral", skipped: "neutral", declined: "neutral", closed_by_decision: "warning", rejected: "neutral",
};

/** Formats one field value for display, with links for referenced records. */
export function FieldValue({ field, value, labels }: { field: Field | undefined; value: unknown; labels?: Record<string, Record<string, string>> }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">Not set</span>;
  if (!field) return <span>{String(value)}</span>;
  switch (field.type) {
    case "money":
      return <span className="tabular">{money(value as number, true)}</span>;
    case "percent":
      return <span className="tabular">{pct(value as number, 3)}</span>;
    case "number":
      return <span className="tabular">{num(value as number, 2)}</span>;
    case "date":
      return <span className="whitespace-nowrap">{date(String(value))}</span>;
    case "datetime":
      return <span className="whitespace-nowrap">{dateTime(String(value))}</span>;
    case "boolean":
      return <span>{value ? "Yes" : "No"}</span>;
    case "ref": {
      const id = String(value);
      const label = labels?.[field.ref!]?.[id] ?? "Open record";
      return (
        <Link className="text-teal-800 underline-offset-2 hover:underline" href={recordHref(field.ref!, id)}>
          {label}
        </Link>
      );
    }
    case "select": {
      const label = field.options?.find((o) => o.value === String(value))?.label ?? String(value);
      if (field.name === "status" || field.name === "review_status" || field.name === "resolution") return <Badge variant={STATUS_TONE[String(value)] ?? "neutral"}>{label}</Badge>;
      if (field.name === "metric_key") return <span>{metricLabel(String(value))}</span>;
      if (field.name === "operator") return <span>{OPERATOR_LABELS[value as Operator] ?? String(value)}</span>;
      return <span>{label}</span>;
    }
    case "multiselect":
    case "tags": {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.length) return <span className="text-muted-foreground">None</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {arr.map((v) => (
            <Badge key={String(v)} variant="neutral">
              {field.options?.find((o) => o.value === String(v))?.label ?? String(v)}
            </Badge>
          ))}
        </span>
      );
    }
    case "actions": {
      const arr = Array.isArray(value) ? (value as { type: string; title?: string; message?: string; options?: string[] }[]) : [];
      return (
        <ul className="list-disc space-y-0.5 pl-4">
          {arr.map((a, i) => (
            <li key={i}>
              {a.type === "create_task" && `Create the task "${a.title}"`}
              {a.type === "create_alert" && `Add the alert "${a.message}" to Home`}
              {a.type === "open_decision" && `Open the decision "${a.title}" with options: ${(a.options ?? []).join(" / ")}`}
            </li>
          ))}
        </ul>
      );
    }
    case "json":
      return <code className="text-xs">{JSON.stringify(value)}</code>;
    case "url":
      return (
        <a className="text-teal-800 underline-offset-2 hover:underline" href={String(value)} target="_blank" rel="noreferrer">
          {String(value)}
        </a>
      );
    default:
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <Badge variant={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
