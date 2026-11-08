import { Download, Table2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { YearCategoryReport, YearCategoryRow } from "@projeto41/contracts";
import { ColorDot } from "../ColorPicker.js";
import { Dropdown, type DropdownOption } from "../forms.js";
import { Button, Empty, Panel, Skeleton } from "../ui.js";
import { PeriodStepper } from "./PeriodPicker.js";
import { api } from "../../lib/api.js";
import { amountFromCents, monthShort } from "../../lib/format.js";
import { isMoneyAccount, useLedgerReference } from "../../lib/ledger.js";

/** "Sem categoria" no filtro: o id dela é nulo, e a lista suspensa quer string ou número. */
const NONE = "none";
type CategoryChoice = number | typeof NONE;

const STORAGE_KEY = "projeto41.yearSheet";

type Saved = { accountIds: number[]; categoryIds: CategoryChoice[] };

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accountIds: [], categoryIds: [] };
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      accountIds: Array.isArray(parsed.accountIds) ? parsed.accountIds : [],
      categoryIds: Array.isArray(parsed.categoryIds) ? parsed.categoryIds : []
    };
  } catch {
    return { accountIds: [], categoryIds: [] };
  }
}

function writeSaved(saved: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Sem armazenamento (janela privada), a escolha só vale nesta visita.
  }
}

const tone = (cents: number) => (cents < 0 ? "fin-negative" : cents > 0 ? "fin-positive" : "fin-muted");

/**
 * Planilha anual do Painel: cada categoria escolhida numa linha, os doze
 * meses nas colunas, subtotal de entradas e de saídas e o resultado do mês.
 *
 * Valores com o sinal do livro — entrada positiva, saída negativa — para a
 * linha de resultado ser a soma das de cima, como numa planilha. As somas
 * chegam prontas da rota; aqui só se desenha.
 */
export function YearCategorySheet({ initialYear }: { initialYear: number }) {
  const reference = useLedgerReference();
  const [year, setYear] = useState(initialYear);
  const [saved, setSaved] = useState<Saved>(readSaved);
  const [report, setReport] = useState<YearCategoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // O ano do Painel manda quando ele muda; daqui em diante, o da planilha anda sozinho.
  useEffect(() => setYear(initialYear), [initialYear]);

  useEffect(() => writeSaved(saved), [saved]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ year: String(year) });
    for (const id of saved.accountIds) params.append("accountId", String(id));
    for (const id of saved.categoryIds) params.append("categoryId", String(id));
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
  }, [year, saved]);

  const accountOptions = useMemo<DropdownOption<number>[]>(
    () =>
      reference.accounts
        .filter((account) => isMoneyAccount(account) || account.kind === "credit_card")
        .map((account) => ({
          value: account.id,
          label: account.name,
          color: account.color,
          hint: account.personName ?? undefined
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

  const hasRows = report != null && report.income.rows.length + report.expense.rows.length > 0;

  function exportCsv() {
    if (!report) return;
    const csvAmount = (cents: number) => ((cents || 0) / 100).toFixed(2).replace(".", ",");
    const line = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";");
    const rowLine = (label: string, months: number[], total: number) =>
      line([label, ...months.map(csvAmount), csvAmount(total), csvAmount(Math.round(total / 12))]);
    const lines = [line(["Categoria", ...monthShort, "Total", "Média"])];
    for (const [title, section] of [
      ["Entradas", report.income],
      ["Saídas", report.expense]
    ] as const) {
      if (section.rows.length === 0) continue;
      for (const row of section.rows) lines.push(rowLine(row.name, row.months, row.totalCents));
      lines.push(rowLine(`Total ${title.toLowerCase()}`, section.months, section.totalCents));
    }
    lines.push(rowLine("Resultado", report.net.months, report.net.totalCents));
    // BOM para o Excel abrir os acentos certos.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `planilha-${report.year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel
      title={
        <span className="fin-inline">
          <Table2 size={15} aria-hidden />
          Planilha do ano
        </span>
      }
      subtitle="Categorias × meses, por conta. Entradas positivas, saídas negativas."
      action={
        <Button variant="ghost" icon={Download} onClick={exportCsv} disabled={!hasRows}>
          Exportar CSV
        </Button>
      }
    >
      <div className="fin-sheet-filters">
        <PeriodStepper
          label={String(year)}
          onPrevious={() => setYear((value) => value - 1)}
          onNext={() => setYear((value) => value + 1)}
          onToday={() => setYear(new Date().getFullYear())}
          isToday={year === new Date().getFullYear()}
        />
        <div className="fin-sheet-filter">
          <Dropdown<number>
            multiple
            value={saved.accountIds}
            onChange={(accountIds) => setSaved((current) => ({ ...current, accountIds }))}
            options={accountOptions}
            placeholder="Todas as contas"
            aria-label="Contas"
          />
        </div>
        <div className="fin-sheet-filter">
          <Dropdown<CategoryChoice>
            multiple
            value={saved.categoryIds}
            onChange={(categoryIds) => setSaved((current) => ({ ...current, categoryIds }))}
            options={categoryOptions}
            placeholder="Todas as categorias"
            aria-label="Categorias"
          />
        </div>
      </div>

      {error && <p className="fin-negative">{error}</p>}
      {loading && !report && <Skeleton rows={6} />}
      {report && !hasRows && <Empty icon={Table2} text={`Nenhum lançamento em ${report.year}.`} />}
      {report && hasRows && (
        <div className={`table-scroll fin-sheet ${loading ? "is-loading" : ""}`}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Categoria</th>
                {monthShort.map((month) => (
                  <th key={month} className="right">
                    {month}
                  </th>
                ))}
                <th className="right">Total</th>
                <th className="right">Média</th>
              </tr>
            </thead>
            <tbody>
              <Section title="Entradas" section={report.income} />
              <Section title="Saídas" section={report.expense} />
            </tbody>
            <tfoot>
              <SheetRow
                label="Resultado"
                months={report.net.months}
                totalCents={report.net.totalCents}
                className="fin-sheet-net"
                header
              />
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Section({
  title,
  section
}: {
  title: string;
  section: { rows: YearCategoryRow[]; months: number[]; totalCents: number };
}) {
  if (section.rows.length === 0) return null;
  return (
    <Fragment>
      <tr className="fin-sheet-group">
        {/* O rótulo na coluna fixa: numa célula de largura inteira ele rolava para fora. */}
        <td className="fin-sheet-label">{title}</td>
        <td colSpan={14} />
      </tr>
      {section.rows.map((row) => (
        <SheetRow
          key={`${row.kind}:${row.categoryId ?? "none"}`}
          label={
            <span className="fin-inline">
              <ColorDot color={row.color ?? "var(--text-muted)"} />
              {row.name}
            </span>
          }
          months={row.months}
          totalCents={row.totalCents}
        />
      ))}
      <SheetRow
        label={`Total ${title.toLowerCase()}`}
        months={section.months}
        totalCents={section.totalCents}
        className="fin-sheet-subtotal"
      />
    </Fragment>
  );
}

function SheetRow({
  label,
  months,
  totalCents,
  className = "",
  header = false
}: {
  label: ReactNode;
  months: number[];
  totalCents: number;
  className?: string;
  header?: boolean;
}) {
  const Cell = header ? "th" : "td";
  return (
    <tr className={className}>
      <Cell className="fin-sheet-label">{label}</Cell>
      {months.map((cents, index) => (
        <Cell key={index} className={`num right ${cents === 0 ? "fin-muted" : ""}`}>
          {cents === 0 ? "—" : amountFromCents(cents)}
        </Cell>
      ))}
      <Cell className={`num right fin-sheet-total ${tone(totalCents)}`}>
        {amountFromCents(totalCents)}
      </Cell>
      <Cell className="num right fin-muted">{amountFromCents(Math.round(totalCents / 12))}</Cell>
    </tr>
  );
}
