/**
 * When the report job acts (Bram, 2026-11-08), pure and tested in auto-report-rules.test.ts. Minutes are counted from
 * midnight in the owner's time zone. Before the send time: the first reminder from 2 hours before, the second from 30
 * minutes before (the first is skipped when its time has passed). From the send time: the send, when Send automatically
 * is on and the report has not gone out, tried again on each run until 9:00 pm.
 */
export type ReportStep = "none" | "remind1" | "remind2" | "send";

export const LAST_TRY_MIN = 21 * 60;

export function reportStep(i: { nowMin: number; sendMin: number; auto: { reminded1?: string; reminded2?: string; sentAt?: string }; autoSend: boolean }): ReportStep {
  const { nowMin, sendMin, auto } = i;
  if (nowMin >= sendMin) return i.autoSend && !auto.sentAt && nowMin < Math.max(LAST_TRY_MIN, sendMin + 60) ? "send" : "none";
  if (nowMin >= sendMin - 30) return auto.reminded2 ? "none" : "remind2";
  if (nowMin >= sendMin - 120) return auto.reminded1 ? "none" : "remind1";
  return "none";
}
