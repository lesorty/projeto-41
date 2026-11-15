import {
  ArrowDownCircle,
  ArrowUpCircle,
  CreditCard,
  PiggyBank,
  Receipt,
  Scale,
  Settings2,
  Wallet,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CategoryReport, GoalProgress, LedgerSummary, TargetReport } from "@projeto41/contracts";
import { Donut } from "../../components/charts.js";
import { AccountStrip } from "../../components/finance/AccountStrip.js";
import { ColorDot } from "../../components/ColorPicker.js";
import {
  PeriodPicker,
  monthPeriod,
  periodLabel,
  type SelectedPeriod
} from "../../components/finance/PeriodPicker.js";
import { TargetBars } from "../../components/finance/TargetBars.js";
import { TargetDrawer } from "../../components/finance/TargetDrawer.js";
import { YearCategorySheet } from "../../components/finance/YearCategorySheet.js";
import {
  AnimatedNumber,
  Button,
  Card,
  Delta,
  Empty,
  Panel,
  SectionHeading,
  Skeleton
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
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = period.period
        ? `?period=${period.period}`
        : filterToQuery({ from: period.from, to: period.to });
      // Tudo no mesmo recorte. O alvo é mensal: fora de um mês ele não tem o
      // que comparar, e mostrar o do mês corrente ao lado de um ano confundia.
      const [nextSummary, nextTargets, nextReport, nextGoals] = await Promise.all([
        api<LedgerSummary>(`/ledger/summary${query}`),
        period.period
          ? api<TargetReport>(`/ledger/targets?period=${period.period}`)
          : Promise.resolve(null),
        api<CategoryReport>(`/ledger/reports/categories${query}&compare=0`.replace("?&", "?")),
        api<GoalProgress[]>("/ledger/goals")
      ]);
      setGoals(nextGoals);
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
    // A conta-ponte dos investimentos só soma o que foi aportado, não o valor
    // da carteira: aqui ela só confundiria.
    for (const account of summary.accounts.filter((item) => item.kind !== "investment")) {
      const key = account.personName ?? "Sem pessoa";
      groups.set(key, [...(groups.get(key) ?? []), account]);
    }
    return [...groups.entries()];
  }, [summary]);

  const goalsTotal = useMemo(
    () => (goals ?? []).reduce((total, goal) => total + goal.balanceCents, 0),
    [goals]
  );

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

  // O anterior é o mês de antes (ou o ano, ou um recorte do mesmo tamanho).
  const versus =
    period.mode === "month" ? "vs. mês anterior" : period.mode === "year" ? "vs. ano anterior" : "vs. período anterior";
  // Na faixa do topo cabe pouco: o "contra o quê" completo vai na dica.
  const versusShort = period.mode === "month" ? "vs. mês ant." : period.mode === "year" ? "vs. ano ant." : "vs. ant.";

  const hasMovement =
    (summary?.month.incomeCents ?? 0) !== 0 || (summary?.month.expenseCents ?? 0) !== 0;

  return (
    <>
      {/* Período e alvo no próprio cabeçalho: um painel só para o seletor
          empurrava tudo para baixo. */}
      <SectionHeading title="Painel" subtitle={`Finanças de ${periodLabel(period)}`}>
        <PeriodPicker value={period} onChange={setPeriod} />
        <Button variant="ghost" icon={Settings2} onClick={() => setConfiguring(true)} disabled={!targets}>
          Configurar alvo
        </Button>
      </SectionHeading>

      {loading && !summary && <Skeleton rows={6} />}

      {summary && (
        <div className={`fin-dash ${loading ? "is-loading" : ""}`}>
          {/* Seis números numa faixa só. Saldo e fatura lado a lado, nunca
              somados: um é dinheiro que existe, o outro é dívida que vai sair
              dele. O sistema não projeta entradas e saídas futuras. */}
          <Card className="fin-kpis">
            <KpiCell
              icon={Wallet}
              label="Saldo"
              hint="Hoje, nas contas do patrimônio"
              value={
                <AnimatedNumber
                  value={summary.consolidated.currentCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              }
              tone={summary.consolidated.currentCents < 0 ? "fin-negative" : ""}
            />
            {/* Elas são contas do patrimônio, então já estão somadas no saldo. */}
            <KpiCell
              icon={PiggyBank}
              label="Caixinhas"
              hint="Guardado, já somado ao saldo"
              value={
                <AnimatedNumber value={goalsTotal / 100} format={(value) => moneyFromCents(value * 100)} />
              }
            />
            <KpiCell
              icon={CreditCard}
              label="Fatura"
              hint="Faturas correntes dos cartões"
              value={
                <AnimatedNumber
                  value={summary.consolidated.cardStatementCents / 100}
                  format={(value) => moneyFromCents(value * 100)}
                />
              }
              tone={summary.consolidated.cardStatementCents > 0 ? "fin-negative" : ""}
            />
            <KpiCell
              icon={ArrowUpCircle}
              label="Entradas"
              onClick={() => open("income")}
              ariaLabel="Ver as entradas do período"
              value={moneyFromCents(summary.month.incomeCents)}
              tone="fin-positive"
              hint={
                <Delta
                  value={ratio(summary.month.incomeCents, summary.previousMonth.incomeCents)}
                  suffix={versusShort}
                  title={`Antes: ${moneyFromCents(summary.previousMonth.incomeCents)} (${versus})`}
                />
              }
            />
            {/* Saída vem negativa do livro: a comparação é sobre o quanto saiu,
                então gastar mais sobe a seta e fica vermelho. */}
            <KpiCell
              icon={ArrowDownCircle}
              label="Saídas"
              onClick={() => open("expenses")}
              ariaLabel="Ver os gastos do período"
              value={moneyFromCents(Math.abs(summary.month.expenseCents))}
              tone="fin-negative"
              hint={
                <Delta
                  value={ratio(
                    Math.abs(summary.month.expenseCents),
                    Math.abs(summary.previousMonth.expenseCents)
                  )}
                  goodWhen="down"
                  suffix={versusShort}
                  title={`Antes: ${moneyFromCents(Math.abs(summary.previousMonth.expenseCents))} (${versus})`}
                />
              }
            />
            <KpiCell
              icon={Scale}
              label="Líquido"
              onClick={() => open("transactions")}
              ariaLabel="Ver todas as transações do período"
              value={moneyFromCents(summary.month.netCents)}
              tone={summary.month.netCents < 0 ? "fin-negative" : ""}
              hint={
                <Delta
                  value={ratio(summary.month.netCents, summary.previousMonth.netCents)}
                  suffix={versusShort}
                  title={`Antes: ${moneyFromCents(summary.previousMonth.netCents)} (${versus})`}
                />
              }
            />
          </Card>

          <AccountStrip accounts={summary.accounts} />

          {/* Alvo e saldos empilhados ao lado da rosca: lado a lado em três
              colunas, o alvo (uma barra só) sobrava vazio na altura da rosca. */}
          <div className="fin-dash-grid">
            <div className="fin-dash-stack">
              {targets ? (
                <Panel title="Alvo × realizado" subtitle="Clique numa barra para ver os gastos da pessoa">
                  <TargetBars report={targets} onSelect={(bar) => open("expenses", bar.personId)} />
                </Panel>
              ) : (
                <Panel title="Alvo × realizado">
                  <p className="fin-muted">O alvo é mensal: escolha um mês para comparar.</p>
                </Panel>
              )}

              <Panel title="Saldo por conta" subtitle="Agrupado por pessoa">
                {summary.accounts.length === 0 && (
                  <Empty icon={Wallet} text="Nenhuma conta cadastrada." />
                )}
                <div className="fin-scroll fin-dash-accounts">
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
                </div>
              </Panel>
            </div>

            <Panel
              title="Gasto por categoria"
              subtitle={periodLabel(period)}
              action={
                <Button variant="ghost" onClick={() => open("reports")}>
                  Relatórios
                </Button>
              }
            >
              {slices.length === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no período." />
              ) : (
                <Donut
                  data={slices}
                  legend
                  showValue
                  formatValue={moneyFromCents}
                  height={230}
                  center={{ label: "Total", value: moneyFromCents(report?.totalCents ?? 0) }}
                />
              )}
            </Panel>
          </div>

          {!hasMovement && summary.accounts.length > 0 && (
            <Empty icon={Receipt} text="Nenhum lançamento neste período." />
          )}

          <YearCategorySheet initialYear={Number(period.from.slice(0, 4))} />
        </div>
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
 * Um número da faixa do topo. Com `onClick` vira botão e leva à tela que
 * detalha aquele número, no mesmo recorte.
 */
function KpiCell({
  icon: Icon,
  label,
  value,
  hint,
  tone = "",
  onClick,
  ariaLabel
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const body = (
    <>
      <span className="fin-kpi-label">
        <Icon size={14} aria-hidden />
        {label}
      </span>
      <strong className={`fin-kpi-value ${tone}`}>{value}</strong>
      {hint && <small className="fin-kpi-hint">{hint}</small>}
    </>
  );
  return onClick ? (
    <button type="button" className="fin-kpi is-link" onClick={onClick} aria-label={ariaLabel}>
      {body}
    </button>
  ) : (
    <div className="fin-kpi">{body}</div>
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
