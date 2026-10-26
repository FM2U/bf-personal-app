import { date as fmtDate, money, months as fmtMonths } from "@/lib/format";
import type { Row } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

/** The saved copy of a partner report. Used in the app and on the public link page. */
export function ReportView({ report }: { report: Row }) {
  const s = report.snapshot ?? {};
  return (
    <div className="flex flex-col gap-4">
      {report.summary ? (
        <Section title="Summary">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.summary}</p>
        </Section>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {s.runway ? (
          <Section title="Runway and cash trend">
            <div className="grid grid-cols-3 gap-3">
              <Pair label="Runway" value={fmtMonths(s.runway.months)} />
              <Pair label="Target" value={s.runway.target_months ? `${s.runway.target_months} months` : "Not set"} />
              <Pair label="Cash" value={money(s.runway.cash)} />
            </div>
            {s.runway.cash_trend?.length ? (
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {(s.runway.cash_trend as Row[]).map((r) => (
                    <tr key={r.month} className="border-t border-slate-100">
                      <td className="py-1 text-muted-foreground">{fmtDate(`${r.month}-01`, "MMMM yyyy")}</td>
                      <td className="tabular py-1 text-right">{money(r.cash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Section>
        ) : null}
        {s.milestones ? (
          <Section title="Milestones completed and missed">
            <p className="mb-1 text-xs font-medium text-emerald-700">Completed ({s.milestones.completed.length})</p>
            <ul className="mb-3 list-disc pl-5 text-sm">
              {(s.milestones.completed as Row[]).map((m, i) => (
                <li key={i}>
                  {m.title} ({fmtDate(m.met_on)})
                </li>
              ))}
              {!s.milestones.completed.length ? <li className="text-muted-foreground">None this period</li> : null}
            </ul>
            <p className="mb-1 text-xs font-medium text-red-700">Missed ({s.milestones.missed.length})</p>
            <ul className="mb-3 list-disc pl-5 text-sm">
              {(s.milestones.missed as Row[]).map((m, i) => (
                <li key={i}>
                  {m.title} (due {fmtDate(m.due_date)})
                </li>
              ))}
              {!s.milestones.missed.length ? <li className="text-muted-foreground">None this period</li> : null}
            </ul>
            {s.milestones.upcoming?.length ? (
              <>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Next</p>
                <ul className="list-disc pl-5 text-sm">
                  {(s.milestones.upcoming as Row[]).map((m, i) => (
                    <li key={i}>
                      {m.title} (due {fmtDate(m.due_date)})
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>
        ) : null}
        {s.commitments ? (
          <Section title="Commitment completion score">
            <div className="grid grid-cols-3 gap-3">
              <Pair label="Score" value={s.commitments.score.pct === null ? "No commitments due" : `${s.commitments.score.pct}%`} />
              <Pair label="Met" value={s.commitments.score.met} />
              <Pair label="Missed" value={s.commitments.score.missed} />
            </div>
            {s.commitments.repeated_misses?.length ? (
              <>
                <p className="mb-1 mt-3 text-xs font-medium text-red-700">Repeated misses</p>
                <ul className="list-disc pl-5 text-sm">
                  {(s.commitments.repeated_misses as Row[]).map((r, i) => (
                    <li key={i}>
                      {r.title}: missed {r.misses} times
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>
        ) : null}
        {s.savings ? (
          <Section title="Savings achieved">
            <div className="grid grid-cols-3 gap-3">
              <Pair label="Monthly savings from completed actions" value={money(s.savings.monthly_savings_achieved)} />
              <Pair label="Actions completed" value={s.savings.completed_actions} />
              <Pair label="Emergency fund progress" value={s.savings.emergency_fund_pct === null ? "Not set" : `${s.savings.emergency_fund_pct}%`} />
            </div>
          </Section>
        ) : null}
        {s.loans ? (
          <Section title="Loan repayment status">
            {(s.loans as Row[]).length ? (
              (s.loans as Row[]).map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-3 last:border-0 sm:grid-cols-4">
                  <Pair label="Loan amount" value={money(l.amount)} />
                  <Pair label="Repaid to date" value={money(l.paid_to_date)} />
                  <Pair label="Remaining principal" value={money(l.remaining_principal)} />
                  <Pair label="Next payment" value={l.next_payment ? `${money(l.next_payment.amount)} on ${fmtDate(l.next_payment.due_date)}` : "None scheduled"} />
                  {l.overdue_payments ? <p className="col-span-full text-sm text-red-700">{l.overdue_payments} payment(s) overdue.</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No loans linked to this accountability partner.</p>
            )}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
