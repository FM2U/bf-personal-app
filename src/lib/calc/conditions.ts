export type Operator = "lt" | "lte" | "gt" | "gte" | "eq" | "neq";

export const OPERATOR_LABELS: Record<Operator, string> = {
  lt: "is less than",
  lte: "is less than or equal to",
  gt: "is greater than",
  gte: "is greater than or equal to",
  eq: "equals",
  neq: "does not equal",
};

export type ConditionAction =
  | { type: "create_task"; title: string; due_in_days?: number }
  | { type: "create_alert"; message: string; severity?: "info" | "warning" | "critical" }
  | { type: "open_decision"; title: string; options: string[] };

export type Condition = {
  id: string;
  metric_key: string;
  operator: Operator;
  threshold: number;
  check_from: string | null;
  is_active: boolean;
  currently_met: boolean;
};

export function compare(value: number, op: Operator, threshold: number): boolean {
  switch (op) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "eq":
      return Math.abs(value - threshold) < 1e-9;
    case "neq":
      return Math.abs(value - threshold) >= 1e-9;
  }
}

export type Evaluation = {
  applicable: boolean;
  met: boolean;
  value: number | null;
  /** "trigger" = run the actions now (rule became true); "rearm" = rule became false again; "none" = no change */
  transition: "trigger" | "rearm" | "none";
};

/**
 * Evaluate one rule against the current metric values.
 * A rule only runs its actions when it changes from not met to met, so a rule that stays true
 * does not create the same task every day. A metric with no value (null) is treated as not met.
 * A rule with check_from is not checked before that date.
 */
export function evaluateCondition(c: Condition, metrics: Record<string, number | null>, today: string): Evaluation {
  if (!c.is_active || (c.check_from && today < c.check_from)) {
    return { applicable: false, met: false, value: metrics[c.metric_key] ?? null, transition: "none" };
  }
  const value = metrics[c.metric_key];
  const met = value !== null && value !== undefined && compare(value, c.operator, Number(c.threshold));
  let transition: Evaluation["transition"] = "none";
  if (met && !c.currently_met) transition = "trigger";
  if (!met && c.currently_met) transition = "rearm";
  return { applicable: true, met, value: value ?? null, transition };
}

export function parseActions(raw: unknown): ConditionAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is ConditionAction =>
      !!a &&
      typeof a === "object" &&
      ((a.type === "create_task" && typeof a.title === "string") ||
        (a.type === "create_alert" && typeof a.message === "string") ||
        (a.type === "open_decision" && typeof a.title === "string" && Array.isArray(a.options))),
  );
}
