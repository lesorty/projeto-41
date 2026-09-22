import { ArrowDownCircle, ArrowUpCircle, PiggyBank, Receipt, Settings2, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryReport, LedgerSummary, TargetReport } from "@projeto41/contracts";
import { Donut } from "../../components/charts.js";
import { ColorDot } from "../../components/ColorPicker.js";
import {
  PeriodPicker,
  monthPeriod,
  periodLabel,
  type SelectedPeriod
} from "../../components/finance/PeriodPicker.js";
import { TargetBars } from "../../components/finance/TargetBars.js";
import { TargetDrawer } from "../../components/finance/TargetDrawer.js";
import {
  AnimatedNumber,
  Button,
  Delta,
  Empty,
  Panel,
  SectionHeading,
  Skeleton,
  Stat
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents } from "../../lib/format.js";
import { filterToQuery } from "../../lib/ledger.js";
import { useToast } from "../../lib/toast.js";

/**
 * Painel do modulo.
 *
 * Nenhuma soma acontece aqui: saldo, resumo, alvo e rosca chegam prontos das
 * rotas da fase 2.
 */
export function FinanceDashboardPage({ onOpenReports }: { onOpenReports: () => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState<SelectedPeriod>(() => monthPeriod(0));
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [targets, setTargets] = useState<TargetReport | null>(null);
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = period.period
        ? `?period=${period.period}`
        : filterToQuery({ from: period.from, to: period.to });
      const [nextSummary, nextTargets, nextReport] = await Promise.all([
        api<LedgerSummary>(`/ledger/summary${period.period ? `?period=${period.period}` : ""}`),
        api<TargetReport>(`/ledger/targets${period.period ? `?period=${period.period}` : ""}`),
        api<CategoryReport>(`/ledger/reports/categories${query}&compare=0`.replace("?&", "?"))
      ]);
      setSummary(nextSummary);
      setTargets(nextTargets);
      setReport(nextReport);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const byPerson = useMemo(() => {
    if (!summary) return [];
    const groups = new Map<string, LedgerSummary["accounts"]>();
    for (const account of summary.accounts) {
      const key = account.personName ?? "Sem pessoa";
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    return [...groups.entries()];
  }, [summary]);

  const slices = useMemo(
    () =>
      (report?.slices ?? []).map((slice) => ({
        key: String(slice.categoryId ?? slice.name),
        label: slice.name,
        value: slice.valueCents,
        color: slice.color ?? undefined,
        percentLabel: `${(slice.sharePerMille / 10).toFixed(1).replace(".", ",")}%`
      })),
    [report]
  );

  const hasMovement =
    (summary?.month.incomeCents ?? 0) !== 0 || (summary?.month.expenseCents ?? 0) !== 0;

  return (
    <>
      <SectionHeading title="Painel" subtitle={`Finanças de ${periodLabel(period)}`}>
        <Button variant="ghost" icon={Settings2} onClick={() => setConfiguring(true)} disabled={!targets}>
          Configurar alvo
        </Button>
      </SectionHeading>

      <Panel bodyClass="fin-filter-body">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Panel>

      {loading && <Skeleton rows={6} />}

      {!loading && summary && (
        <>
          <div className="fin-summary">
            {/* Atual e previsto são números diferentes e ficam lado a lado,
                rotulados: trocá-los é o erro mais caro desta tela (6.1). */}
            <Panel title="Saldo consolidado" subtitle="Hoje, sem cartão">
              <AnimatedNumber
                value={summary.consolidated.currentCents / 100}
                format={(value) => moneyFromCents(value * 100)}
              />
            </Panel>
            <Panel title="Saldo previsto" subtitle="Incluindo o que está pendente">
              <AnimatedNumber
                value={summary.consolidated.projectedCents / 100}
                format={(value) => moneyFromCents(value * 100)}
              />
            </Panel>
          </div>

          <div className="fin-summary">
            <Stat
              icon={ArrowUpCircle}
              label="Entradas"
              value={moneyFromCents(summary.month.incomeCents)}
              detail={<Delta value={ratio(summary.month.incomeCents, summary.previousMonth.incomeCents)} />}
            />
            <Stat
              icon={ArrowDownCircle}
              label="Saídas"
              value={moneyFromCents(summary.month.expenseCents)}
              detail={
                <Delta value={ratio(summary.month.expenseCents, summary.previousMonth.expenseCents)} />
              }
            />
            <Stat
              icon={PiggyBank}
              label="Líquido"
              value={moneyFromCents(summary.month.netCents)}
              detail={<Delta value={ratio(summary.month.netCents, summary.previousMonth.netCents)} />}
            />
          </div>

          {targets && (
            <Panel
              title="Alvo × realizado"
              subtitle="Quanto cada um deveria gastar, contra o que gastou"
            >
              <TargetBars report={targets} />
            </Panel>
          )}

          <div className="fin-columns">
            <Panel title="Saldo por conta" subtitle="Agrupado por pessoa">
              {summary.accounts.length === 0 && (
                <Empty icon={Wallet} text="Nenhuma conta cadastrada." />
              )}
              {byPerson.map(([name, accounts]) => (
                <div key={name} className="fin-account-group">
                  <h4>{name}</h4>
                  <ul className="fin-list">
                    {accounts.map((account) => (
                      <li key={account.id}>
                        <span className="fin-inline">
                          <ColorDot color={account.color} />
                          {account.name}
                        </span>
                        <span className="fin-list-meta">
                          <strong
                            className={account.currentBalanceCents < 0 ? "fin-negative" : ""}
                          >
                            {moneyFromCents(account.currentBalanceCents)}
                          </strong>
                          <small className="fin-muted">
                            prev. {moneyFromCents(account.projectedBalanceCents)}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Panel>

            <Panel
              title="Gasto por categoria"
              subtitle={periodLabel(period)}
              action={
                <Button variant="ghost" onClick={onOpenReports}>
                  Ver relatórios
                </Button>
              }
            >
              {slices.length === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no período." />
              ) : (
                <Donut data={slices} showValue formatValue={moneyFromCents} />
              )}
            </Panel>
          </div>

          {!hasMovement && summary.accounts.length > 0 && (
            <Empty icon={Receipt} text="Nenhum lançamento neste período." />
          )}
        </>
      )}

      {configuring && targets && (
        <TargetDrawer
          report={targets}
          onClose={() => setConfiguring(false)}
          onSaved={(next) => {
            setTargets(next);
            setConfiguring(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Variação contra o mês anterior, para o `Delta`. Anterior zero devolve 0 em
 * vez de infinito — o `Delta` é um indicador, não o comparativo detalhado, que
 * vive na tela de relatórios com a regra completa.
 */
function ratio(current: number, previous: number): number {
  if (previous === 0) return 0;
  return (current - previous) / Math.abs(previous);
}
