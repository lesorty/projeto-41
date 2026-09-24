import { Receipt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryReport, CategoryTrend } from "@projeto41/contracts";
import { fromCents } from "@projeto41/finance";
import { AreaTrend, Donut, DualAreaTrend } from "../../components/charts.js";
import { CategoryTotalsTable, toneClass } from "../../components/finance/CategoryTotalsTable.js";
import {
  PeriodPicker,
  monthPeriod,
  periodLabel,
  type SelectedPeriod
} from "../../components/finance/PeriodPicker.js";
import { Empty, Panel, SectionHeading, Skeleton } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/** Consulta de relatório: mês-calendário usa `period`, recorte livre usa from/to. */
function reportQuery(period: SelectedPeriod, compare: boolean) {
  const params = new URLSearchParams();
  if (period.period) params.set("period", period.period);
  else if (period.year != null) params.set("year", String(period.year));
  else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  params.set("compare", compare ? "1" : "0");
  return `?${params.toString()}`;
}

/** O total da rosca logo abaixo dela: as fatias mostram a parte, aqui fica o todo. */
function DonutTotal({ cents }: { cents: number }) {
  return (
    <p className="fin-donut-total">
      <span>Total</span>
      <strong>{moneyFromCents(cents)}</strong>
    </p>
  );
}

export function ReportsPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<SelectedPeriod>(() => monthPeriod(0));
  const [report, setReport] = useState<CategoryReport | null>(null);
  const [yearReport, setYearReport] = useState<CategoryReport | null>(null);
  const [trend, setTrend] = useState<CategoryTrend[]>([]);
  const [selected, setSelected] = useState<(number | null)[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const year = period.year ?? Number(period.from.slice(0, 4));
      const [next, nextYear] = await Promise.all([
        api<CategoryReport>(`/ledger/reports/categories${reportQuery(period, true)}`),
        api<CategoryReport>(`/ledger/reports/categories?year=${year}&compare=0`)
      ]);
      setReport(next);
      setYearReport(nextYear);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A série só é buscada quando há categoria escolhida: sem seleção não há
  // gráfico de tendência para desenhar.
  useEffect(() => {
    const ids = selected.filter((id): id is number => id != null);
    if (ids.length === 0) {
      setTrend([]);
      return;
    }
    const params = new URLSearchParams({ months: "12" });
    for (const id of ids) params.append("categoryId", String(id));
    if (period.period) params.set("endMonth", period.period);
    void api<CategoryTrend[]>(`/ledger/reports/categories/trend?${params.toString()}`)
      .then(setTrend)
      .catch(() => setTrend([]));
  }, [selected, period.period]);

  function toggleCategory(categoryId: number | null) {
    setSelected((current) => {
      if (current.includes(categoryId)) return current.filter((id) => id !== categoryId);
      // No máximo duas: é o que o gráfico de duas séries comporta.
      return [...current, categoryId].slice(-2);
    });
  }

  const toSlices = (source: CategoryReport | null) =>
    (source?.slices ?? []).map((slice) => ({
      key: String(slice.categoryId ?? slice.name),
      label: slice.name,
      value: slice.valueCents,
      color: slice.color ?? undefined,
      percentLabel: `${(slice.sharePerMille / 10).toFixed(1).replace(".", ",")}%`
    }));

  const trendData = useMemo(() => {
    if (trend.length === 0) return [];
    const months = trend[0]?.points.map((point) => point.month) ?? [];
    return months.map((month, index) => ({
      // `AreaTrend` e `shortAxis` esperam uma data; o dia 1 é só a âncora do mês.
      date: `${month}-01`,
      // Conversão centavos → reais acontece SÓ aqui, na fronteira de
      // renderização, porque o eixo Y usa `compactMoney`, que espera reais.
      // Nenhuma soma acontece depois desta linha.
      a: fromCents(trend[0]?.points[index]?.totalCents ?? 0),
      b: fromCents(trend[1]?.points[index]?.totalCents ?? 0)
    }));
  }, [trend]);

  const comparison = report?.comparison;

  return (
    <>
      <SectionHeading title="Relatórios" subtitle={`Gastos de ${periodLabel(period)}`} />

      <Panel bodyClass="fin-filter-body">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Panel>

      {loading && <Skeleton rows={8} />}

      {!loading && report && (
        <>
          <Panel title="Totais por categoria" subtitle="Clique numa categoria para ver a tendência">
            <CategoryTotalsTable
              report={report}
              onSelectCategory={toggleCategory}
              selectedIds={selected}
            />
          </Panel>

          {trend.length > 0 && (
            <Panel
              title={`Tendência · ${trend.map((series) => series.name).join(" × ")}`}
              subtitle="Últimos 12 meses"
            >
              {trend.length === 1 ? (
                <AreaTrend data={trendData.map(({ date, a }) => ({ date, value: a }))} dataKey="value" />
              ) : (
                <DualAreaTrend
                  data={trendData}
                  xKey="date"
                  keys={["a", "b"]}
                  names={[trend[0]?.name ?? "", trend[1]?.name ?? ""]}
                />
              )}
            </Panel>
          )}

          <div className="fin-donuts">
            <Panel title="Composição do período" subtitle={periodLabel(period)}>
              {report.slices.length === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no período." />
              ) : (
                <>
                  <Donut data={toSlices(report)} showValue formatValue={moneyFromCents} height={320} />
                  <DonutTotal cents={report.totalCents} />
                </>
              )}
            </Panel>
            <Panel title="Composição do ano" subtitle={String(period.year ?? period.from.slice(0, 4))}>
              {(yearReport?.slices.length ?? 0) === 0 ? (
                <Empty icon={Receipt} text="Nenhum gasto no ano." />
              ) : (
                <>
                  <Donut
                    data={toSlices(yearReport)}
                    showValue
                    formatValue={moneyFromCents}
                    height={320}
                  />
                  <DonutTotal cents={yearReport?.totalCents ?? 0} />
                </>
              )}
            </Panel>
          </div>

          {comparison && comparison.rows.length > 0 && (
            <Panel
              title="Comparativo com o período anterior"
              subtitle={`${comparison.previousRange.from} a ${comparison.previousRange.to}`}
            >
              {comparison.partial && (
                // Sem este rótulo o comparativo mente todo dia 3: 21 dias
                // contra 31 sempre parecem "gastou menos".
                <p className="fin-warning">
                  Parcial: {comparison.daysElapsed} de {comparison.daysInPeriod} dias. A comparação
                  usa o período anterior truncado no mesmo dia
                  {comparison.previousToDateCents != null && (
                    <>
                      {" "}
                      ({moneyFromCents(comparison.previousToDateCents)}); o período anterior inteiro
                      somou {moneyFromCents(comparison.previousCents)}.
                    </>
                  )}
                </p>
              )}
              <ul className="fin-comparison">
                {comparison.rows.map((row) => (
                  <li key={row.categoryId ?? row.name}>
                    <span className={toneClass(row.tone)}>{row.label}</span>
                    <small className="fin-muted">
                      {moneyFromCents(row.previousCents)} → {moneyFromCents(row.currentCents)}
                    </small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
