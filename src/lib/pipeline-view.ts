/** Pipelines open in list view. The board is one click away; the last choice per pipeline is remembered in a cookie. */
export type PipelineView = "list" | "board";

export const pipelineViewCookie = (pipelineId: string) => `pipeline_view_${pipelineId.replace(/[^a-zA-Z0-9-]/g, "")}`;

/** The view to show: the one in the address (?view=), else the remembered one, else list. */
export function resolvePipelineView(param: string | undefined, remembered: string | undefined): PipelineView {
  if (param === "board" || param === "list") return param;
  return remembered === "board" ? "board" : "list";
}
