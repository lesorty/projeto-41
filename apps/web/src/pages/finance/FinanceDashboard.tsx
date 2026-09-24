import {
  ArrowDownCircle,
  ArrowUpCircle,
  CreditCard,
  PiggyBank,
  Receipt,
  Settings2,
  Wallet
} from "lucide-react";
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
import type { FinanceDestination, FinanceNavigate } from "../../lib/navigation.js";
import { useToast } from "../../lib/toast.js";

/**
 * Painel do modulo.
 *
 * Nenhuma soma acontece aqui: saldo, resumo, alvo e rosca chegam prontos das
 * rotas da fase 2.
 */
export function FinanceDashboardPage({ onNavigate }: { onNavigate: FinanceNavigate }) {
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

  /** Leva o recorte do Painel junto: chegar em Gastos em outro mes seria refazer o filtro. */
  const open = (page: FinanceDestination, personId?: number | null) =>
    onNavigate(page, {
      from: period.from,
      to: period.to,
      ...(personId != null ? { personId } : {})
    });

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
            {/* Saldo e fatura lado a lado, nunca somados: um é dinheiro que
                existe, o outro é dívida que vai sair dele. O sistema não
                projeta entradas e saídas futuras. */}
            <Panel title="Saldo" subtitle="Hoje, nas contas do patrimônio">
              <strong className={summary.consolidated.currentCents < 0 ? "fin-negative" : ""}>
                <AnimatedNumber
                  value={summary.consolidated.currentCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              </strong>
            </Panel>
            <Panel
              title={
                <span className="fin-inline">
                  <CreditCard size={15} aria-hidden />
                  Fatura
                </span>
              }
              subtitle="Faturas correntes dos cartões"
            >
              <strong className={summary.consolidated.cardStatementCents > 0 ? "fin-negative" : ""}>
                <AnimatedNumber
                  value={summary.consolidated.cardStatementCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              </strong>
            </Panel>
          </div>

          <div className="fin-summary">
            <button
              type="button"
              className="fin-card-link"
              onClick={() => open("income")}
              aria-label="Ver as entradas do período"
            >
              <Stat
                icon={ArrowUpCircle}
                label="Entradas"
                value={moneyFromCents(summary.month.incomeCents)}
                detail={
                  <Delta value={ratio(summary.month.incomeCents, summary.previousMonth.incomeCents)} />
                }
              />
            </button>
            <button
              type="button"
              className="fin-card-link"
              onClick={() => open("expenses")}
              aria-label="Ver os gastos do período"
            >
              <Stat
                icon={ArrowDownCircle}
                label="Saídas"
                value={moneyFromCents(summary.month.expenseCents)}
                detail={
                  <Delta
                    value={ratio(summary.month.expenseCents, summary.previousMonth.expenseCents)}
                  />
                }
              />
            </button>
            <button
              type="button"
              className="fin-card-link"
              onClick={() => open("transactions")}
              aria-label="Ver todas as transações do período"
            >
              <Stat
                icon={PiggyBank}
                label="Líquido"
                value={moneyFromCents(summary.month.netCents)}
                detail={<Delta value={ratio(summary.month.netCents, summary.previousMonth.netCents)} />}
              />
            </button>
          </div>

          {targets && (
            <Panel
              title="Alvo × realizado"
              subtitle="Clique numa barra para ver os gastos da pessoa contra os objetivos"
            >
              <TargetBars report={targets} onSelect={(bar) => open("expenses", bar.personId)} />
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
                        <strong className={account.currentBalanceCents < 0 ? "fin-negative" : ""}>
                          {moneyFromCents(account.currentBalanceCents)}
                        </strong>
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
                <Button variant="ghost" onClick={() => open("reports")}>
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
