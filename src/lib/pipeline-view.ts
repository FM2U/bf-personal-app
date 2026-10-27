/**
 * Pipeline page choices:
 * - view: every pipeline opens in list view on every visit; the board is one click away (?view=board) and is not
 *   remembered as the default.
 * - closed stages: shown by default (the board fits all stages, including Closed and Passed); "Hide closed stages"
 *   is one click away and is remembered the same way.
 */
export type PipelineView = "list" | "board";

export const pipelineClosedCookie = (pipelineId: string) => `pipeline_closed_${pipelineId.replace(/[^a-zA-Z0-9-]/g, "")}`;

/** The view to show: the one in the address (?view=board), else list. A board chosen earlier is not remembered. */
export function resolvePipelineView(param: string | undefined): PipelineView {
  return param === "board" ? "board" : "list";
}

/** Show closed stages (and closed items): the address (?closed=1 or 0), else the remembered choice, else shown. */
export function resolveShowClosed(param: string | undefined, remembered: string | undefined): boolean {
  if (param === "1") return true;
  if (param === "0") return false;
  return remembered !== "hide";
}
