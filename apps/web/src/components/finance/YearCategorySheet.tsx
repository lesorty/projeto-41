import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Table2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  YearCategoryGroupBy,
  YearCategoryMatrix,
  YearCategoryReport,
  YearCategoryRow,
  YearCategorySection
} from "@projeto41/contracts";
import { ColorDot } from "../ColorPicker.js";
import { Dropdown, type DropdownOption } from "../forms.js";
import { Button, Empty, Panel, Skeleton } from "../ui.js";
import { PeriodStepper } from "./PeriodPicker.js";
import { api } from "../../lib/api.js";
import { amountFromCents, monthNames, monthShort, moneyFromCents } from "../../lib/format.js";
import { isMoneyAccount, useLedgerReference } from "../../lib/ledger.js";

/** "Sem categoria" no filtro: o id dela é nulo, e a lista suspensa quer string ou número. */
const NONE = "none";
type CategoryChoice = number | typeof NONE;

const STORAGE_KEY = "projeto41.yearSheet";

type Saved = {
  accountIds: number[];
  categoryIds: CategoryChoice[];
  groupBy: YearCategoryGroupBy;
  cents: boolean;
};

const DEFAULTS: Saved = { accountIds: [], categoryIds: [], groupBy: "none", cents: false };

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      accountIds: Array.isArray(parsed.accountIds) ? parsed.accountIds : [],
      categoryIds: Array.isArray(parsed.categoryIds) ? parsed.categoryIds : [],
      groupBy: ["none", "account", "method"].includes(parsed.groupBy as string)
        ? (parsed.groupBy as YearCategoryGroupBy)
        : "none",
      cents: parsed.cents === true
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSaved(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Sem armazenamento (janela privada), a escolha só vale nesta visita.
  }
}

const GROUPINGS: { value: YearCategoryGroupBy; label: string }[] = [
  { value: "none", label: "Tudo junto" },
  { value: "account", label: "Por conta" },
  { value: "method", label: "Débito × Crédito" }
];

const tone = (cents: number) => (cents < 0 ? "fin-negative" : cents > 0 ? "fin-positive" : "fin-muted");

/** Como cada coluna de mês se apresenta: já passou, é o mês corrente ou ainda vem. */
type MonthState = "past" | "current" | "future";

/**
 * Visão do ano: cada categoria numa linha, os doze meses nas colunas, com
 * subtotal de entradas e de saídas e o resultado de cada mês — a planilha que
 * agrega o ano inteiro. Pode vir tudo junto ou em blocos por conta ou por
 * débito (conta) e crédito (cartão), cada bloco recolhível.
 *
 * Valores com o sinal do livro — entrada positiva, saída negativa — para a
 * linha de resultado ser a soma das de cima. As somas e médias chegam prontas
 * da rota; aqui só se desenha.
 */
export function YearCategorySheet({ initialYear }: { initialYear: number }) {
  const reference = useLedgerReference();
  const [year, setYear] = useState(initialYear);
  const [saved, setSaved] = useState<Saved>(readSaved);
  const [report, setReport] = useState<YearCategoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // O ano do Painel manda quando ele muda; daqui em diante, o da planilha anda sozinho.
  useEffect(() => setYear(initialYear), [initialYear]);

  useEffect(() => writeSaved(saved), [saved]);

  const { accountIds, categoryIds, groupBy } = saved;
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ year: String(year), groupBy });
    for (const id of accountIds) params.append("accountId", String(id));
    for (const id of categoryIds) params.append("categoryId", String(id));
    setLoading(true);
    api<YearCategoryReport>(`/ledger/reports/categories/year?${params.toString()}`)
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setError("");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, accountIds, categoryIds, groupBy]);

  const accountOptions = useMemo<DropdownOption<number>[]>(
    () =>
      reference.accounts
        .filter((account) => isMoneyAccount(account) || account.kind === "credit_card")
        .map((account) => ({
          value: account.id,
          label: account.name,
          color: account.color,
          hint: [account.kind === "credit_card" ? "Crédito" : "Conta", account.personName]
            .filter(Boolean)
            .join(" · ")
        })),
    [reference.accounts]
  );

  const categoryOptions = useMemo<DropdownOption<CategoryChoice>[]>(
    () => [
      ...reference.categories
        .filter((category) => !category.archived)
        .map((category) => ({
          value: category.id as CategoryChoice,
          label: category.name,
          color: category.color,
          hint: category.kind === "income" ? "Entrada" : "Saída"
        })),
      { value: NONE, label: "Sem categoria" }
    ],
    [reference.categories]
  );

  const total = report?.total;
  const hasRows = total != null && total.income.rows.length + total.expense.rows.length > 0;
  const grouped = report != null && report.groupBy !== "none" && report.groups.length > 0;
  const elapsed = report?.monthsElapsed ?? 12;
  const monthStates: MonthState[] = Array.from({ length: 12 }, (_, index) => {
    if (elapsed === 12 || index + 1 < elapsed) return "past";
    return index + 1 === elapsed ? "current" : "future";
  });
  const format = (cents: number) => amountFromCents(cents, { whole: !saved.cents });

  const allCollapsed = grouped && report.groups.every((group) => collapsed.has(group.key));
  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCsv() {
    if (!report) return;
    const csvAmount = (cents: number | null) =>
      cents == null ? "" : ((cents || 0) / 100).toFixed(2).replace(".", ",");
    const line = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";");
    const rowLine = (label: string, months: number[], totalCents: number, average: number | null) =>
      line([label, ...months.map(csvAmount), csvAmount(totalCents), csvAmount(average)]);
    const matrixLines = (matrix: YearCategoryMatrix, prefix = "") => {
      const out: string[] = [];
      for (const [title, section] of [
        ["Entradas", matrix.income],
        ["Saídas", matrix.expense]
      ] as const) {
        if (section.rows.length === 0) continue;
        for (const row of section.rows) {
          out.push(rowLine(`${prefix}${row.name}`, row.months, row.totalCents, row.averageCents));
        }
        out.push(
          rowLine(
            `${prefix}Total ${title.toLowerCase()}`,
            section.months,
            section.totalCents,
            section.averageCents
          )
        );
      }
      return out;
    };
    const lines = [line(["Categoria", ...monthShort, "Total", "Média"])];
    if (grouped) {
      for (const group of report.groups) {
        lines.push(line([group.label]));
        lines.push(...matrixLines(group.matrix, "  "));
        lines.push(
          rowLine(
            `  Resultado ${group.label}`,
            group.matrix.net.months,
            group.matrix.net.totalCents,
            group.matrix.net.averageCents
          )
        );
      }
      for (const [title, section] of [
        ["entradas", report.total.income],
        ["saídas", report.total.expense]
      ] as const) {
        lines.push(rowLine(`Total ${title}`, section.months, section.totalCents, section.averageCents));
      }
    } else {
      lines.push(...matrixLines(report.total));
    }
    lines.push(
      rowLine(
        "Resultado",
        report.total.net.months,
        report.total.net.totalCents,
        report.total.net.averageCents
      )
    );
    // BOM para o Excel abrir os acentos certos.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `visao-do-ano-${report.year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const averageLabel = elapsed > 0 && elapsed < 12 ? `Média ${elapsed}m` : "Média";

  return (
    <Panel
      className="fin-year"
      title={
        <span className="fin-inline">
          <Table2 size={15} aria-hidden />
          Visão do ano
        </span>
      }
      subtitle="Quanto entrou e saiu em cada categoria, mês a mês. Entradas positivas, saídas negativas."
      action={
        <div className="fin-year-actions">
          {grouped && (
            <Button
              variant="ghost"
              icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
              onClick={() =>
                setCollapsed(allCollapsed ? new Set() : new Set(report.groups.map((group) => group.key)))
              }
            >
              {allCollapsed ? "Expandir blocos" : "Recolher blocos"}
            </Button>
          )}
          <Button variant="ghost" icon={Download} onClick={exportCsv} disabled={!hasRows}>
            Exportar CSV
          </Button>
        </div>
      }
    >
      <div className="fin-year-toolbar">
        <PeriodStepper
          label={String(year)}
          onPrevious={() => setYear((value) => value - 1)}
          onNext={() => setYear((value) => value + 1)}
          onToday={() => setYear(new Date().getFullYear())}
          isToday={year === new Date().getFullYear()}
        />
        <div className="period-modes" role="group" aria-label="Agrupar">
          {GROUPINGS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={saved.groupBy === option.value ? "active" : ""}
              onClick={() => setSaved((current) => ({ ...current, groupBy: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="fin-year-filter">
          <Dropdown<number>
            multiple
            value={saved.accountIds}
            onChange={(next) => setSaved((current) => ({ ...current, accountIds: next }))}
            options={accountOptions}
            placeholder="Todas as contas"
            aria-label="Contas"
          />
        </div>
        <div className="fin-year-filter">
          <Dropdown<CategoryChoice>
            multiple
            value={saved.categoryIds}
            onChange={(next) => setSaved((current) => ({ ...current, categoryIds: next }))}
            options={categoryOptions}
            placeholder="Todas as categorias"
            aria-label="Categorias"
          />
        </div>
        <div className="period-modes" role="group" aria-label="Precisão dos valores">
          <button
            type="button"
            className={!saved.cents ? "active" : ""}
            onClick={() => setSaved((current) => ({ ...current, cents: false }))}
            title="Reais inteiros: os doze meses cabem na tela"
          >
            R$
          </button>
          <button
            type="button"
            className={saved.cents ? "active" : ""}
            onClick={() => setSaved((current) => ({ ...current, cents: true }))}
            title="Com centavos"
          >
            0,00
          </button>
        </div>
      </div>

      {error && <p className="fin-negative">{error}</p>}
      {loading && !report && <Skeleton rows={8} />}
      {report && !hasRows && <Empty icon={Table2} text={`Nenhum lançamento em ${report.year}.`} />}

      {report && total && hasRows && (
        <>
          <YearFigures report={report} />
          <div className={`fin-sheet ${loading ? "is-loading" : ""}`}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="fin-sheet-label">Categoria</th>
                  {monthShort.map((month, index) => (
                    <th
                      key={month}
                      className={`right is-${monthStates[index]}`}
                      title={`${monthNames[index]} de ${report.year}${
                        monthStates[index] === "future" ? " · ainda não aconteceu" : ""
                      }`}
                    >
                      {month}
                    </th>
                  ))}
                  <th className="right fin-sheet-total">Total</th>
                  <th
                    className="right fin-sheet-average"
                    title="Média dos meses que já começaram: o que já está lançado para meses futuros não entra"
                  >
                    {averageLabel}
                  </th>
                </tr>
              </thead>

              {grouped ? (
                report.groups.map((group) => {
                  const open = !collapsed.has(group.key);
                  return (
                    <tbody key={group.key} className={`fin-sheet-block ${open ? "is-open" : ""}`}>
                      <SheetRow
                        className="fin-sheet-block-head"
                        states={monthStates}
                        format={format}
                        months={group.matrix.net.months}
                        totalCents={group.matrix.net.totalCents}
                        averageCents={group.matrix.net.averageCents}
                        toneAll
                        label={
                          <button
                            type="button"
                            className="fin-sheet-toggle"
                            aria-expanded={open}
                            onClick={() => toggleGroup(group.key)}
                            title={open ? "Recolher" : "Expandir"}
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {group.color && <ColorDot color={group.color} />}
                            <span className="fin-sheet-toggle-text">
                              <strong>{group.label}</strong>
                              {group.detail && <small>{group.detail}</small>}
                            </span>
                          </button>
                        }
                      />
                      {open && (
                        <MatrixRows matrix={group.matrix} states={monthStates} format={format} nested />
                      )}
                    </tbody>
                  );
                })
              ) : (
                <tbody>
                  <MatrixRows matrix={total} states={monthStates} format={format} />
                </tbody>
              )}

              <tfoot>
                {grouped && (
                  <>
                    <SheetRow
                      label="Total entradas"
                      states={monthStates}
                      format={format}
                      months={total.income.months}
                      totalCents={total.income.totalCents}
                      averageCents={total.income.averageCents}
                      header
                    />
                    <SheetRow
                      label="Total saídas"
                      states={monthStates}
                      format={format}
                      months={total.expense.months}
                      totalCents={total.expense.totalCents}
                      averageCents={total.expense.averageCents}
                      header
                    />
                  </>
                )}
                <SheetRow
                  label="Resultado"
                  className="fin-sheet-net"
                  states={monthStates}
                  format={format}
                  months={total.net.months}
                  totalCents={total.net.totalCents}
                  averageCents={total.net.averageCents}
                  toneAll
                  header
                />
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Os números do ano antes da tabela: é a primeira pergunta. */
function YearFigures({ report }: { report: YearCategoryReport }) {
  const { total } = report;
  const savingsRate =
    total.income.totalCents > 0
      ? Math.round((total.net.totalCents / total.income.totalCents) * 100)
      : null;
  const figures: { label: string; value: string; tone?: string; detail?: string }[] = [
    { label: "Entradas no ano", value: moneyFromCents(total.income.totalCents), tone: "fin-positive" },
    {
      label: "Saídas no ano",
      value: moneyFromCents(Math.abs(total.expense.totalCents)),
      tone: "fin-negative"
    },
    {
      label: "Resultado",
      value: moneyFromCents(total.net.totalCents),
      tone: tone(total.net.totalCents),
      detail: savingsRate != null ? `${savingsRate}% das entradas` : undefined
    },
    {
      label: "Saída média por mês",
      value:
        total.expense.averageCents == null
          ? "—"
          : moneyFromCents(Math.abs(total.expense.averageCents)),
      detail:
        report.monthsElapsed > 0 && report.monthsElapsed < 12
          ? `nos ${report.monthsElapsed} meses até agora`
          : undefined
    }
  ];
  // Por débito × crédito, quanto saiu de cada lado é o que se quer comparar.
  if (report.groupBy === "method") {
    for (const group of report.groups) {
      figures.push({
        label: `Saídas no ${group.label.toLowerCase()}`,
        value: moneyFromCents(Math.abs(group.matrix.expense.totalCents)),
        detail:
          total.expense.totalCents !== 0
            ? `${Math.round((group.matrix.expense.totalCents / total.expense.totalCents) * 100)}% das saídas`
            : undefined
      });
    }
  }
  return (
    <dl className="fin-year-figures">
      {figures.map((figure) => (
        <div key={figure.label}>
          <dt>{figure.label}</dt>
          <dd className={figure.tone ?? ""}>{figure.value}</dd>
          {figure.detail && <small>{figure.detail}</small>}
        </div>
      ))}
    </dl>
  );
}

function MatrixRows({
  matrix,
  states,
  format,
  nested = false
}: {
  matrix: YearCategoryMatrix;
  states: MonthState[];
  format: (cents: number) => string;
  nested?: boolean;
}) {
  return (
    <>
      <Section title="Entradas" section={matrix.income} states={states} format={format} nested={nested} />
      <Section title="Saídas" section={matrix.expense} states={states} format={format} nested={nested} />
    </>
  );
}

function Section({
  title,
  section,
  states,
  format,
  nested
}: {
  title: string;
  section: YearCategorySection;
  states: MonthState[];
  format: (cents: number) => string;
  nested: boolean;
}) {
  if (section.rows.length === 0) return null;
  const nest = nested ? "is-nested" : "";
  return (
    <>
      <tr className={`fin-sheet-group ${nest}`}>
        {/* O rótulo na coluna fixa: numa célula de largura inteira ele rolava para fora. */}
        <td className="fin-sheet-label">{title}</td>
        <td colSpan={14} />
      </tr>
      {section.rows.map((row: YearCategoryRow) => (
        <SheetRow
          key={`${row.kind}:${row.categoryId ?? "none"}`}
          className={nest}
          states={states}
          format={format}
          label={
            <span className="fin-inline">
              <ColorDot color={row.color ?? "var(--text-muted)"} />
              {row.name}
            </span>
          }
          months={row.months}
          totalCents={row.totalCents}
          averageCents={row.averageCents}
        />
      ))}
      <SheetRow
        label={`Total ${title.toLowerCase()}`}
        className={`fin-sheet-subtotal ${nest}`}
        states={states}
        format={format}
        months={section.months}
        totalCents={section.totalCents}
        averageCents={section.averageCents}
      />
    </>
  );
}

function SheetRow({
  label,
  months,
  totalCents,
  averageCents,
  states,
  format,
  className = "",
  header = false,
  toneAll = false
}: {
  label: ReactNode;
  months: number[];
  totalCents: number;
  averageCents: number | null;
  states: MonthState[];
  format: (cents: number) => string;
  className?: string;
  header?: boolean;
  /** Pinta cada mês pelo sinal: só nas linhas de resultado, senão a tabela vira um semáforo. */
  toneAll?: boolean;
}) {
  const Cell = header ? "th" : "td";
  return (
    <tr className={className}>
      <Cell className="fin-sheet-label">{label}</Cell>
      {months.map((cents, index) => (
        <Cell
          key={index}
          className={`num right is-${states[index]} ${
            cents === 0 ? "fin-muted" : toneAll ? tone(cents) : ""
          }`}
          title={cents === 0 ? undefined : moneyFromCents(cents)}
        >
          {cents === 0 ? "—" : format(cents)}
        </Cell>
      ))}
      <Cell
        className={`num right fin-sheet-total ${tone(totalCents)}`}
        title={moneyFromCents(totalCents)}
      >
        {format(totalCents)}
      </Cell>
      <Cell className="num right fin-sheet-average">
        {averageCents == null || averageCents === 0 ? "—" : format(averageCents)}
      </Cell>
    </tr>
  );
}
