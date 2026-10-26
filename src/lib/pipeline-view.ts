/**
 * Pipeline page choices remembered per pipeline in cookies:
 * - view: list (default) or board; the board is one click away.
 * - closed stages: shown by default (the board fits all stages, including Closed and Passed); "Hide closed stages"
 *   is one click away and is remembered the same way.
 */
export type PipelineView = "list" | "board";

export const pipelineViewCookie = (pipelineId: string) => `pipeline_view_${pipelineId.replace(/[^a-zA-Z0-9-]/g, "")}`;
export const pipelineClosedCookie = (pipelineId: string) => `pipeline_closed_${pipelineId.replace(/[^a-zA-Z0-9-]/g, "")}`;

/** The view to show: the one in the address (?view=), else the remembered one, else list. */
export function resolvePipelineView(param: string | undefined, remembered: string | undefined): PipelineView {
  if (param === "board" || param === "list") return param;
  return remembered === "board" ? "board" : "list";
}

/** Show closed stages (and closed items): the address (?closed=1 or 0), else the remembered choice, else shown. */
export function resolveShowClosed(param: string | undefined, remembered: string | undefined): boolean {
  if (param === "1") return true;
  if (param === "0") return false;
  return remembered !== "hide";
}
