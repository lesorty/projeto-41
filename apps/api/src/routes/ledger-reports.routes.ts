import {
  budgetPeriodInputSchema,
  categoryReportQuerySchema,
  categoryTrendQuerySchema,
  periodSchema,
  personPeriodBudgetInputSchema,
  reportRangeSchema,
  yearCategoryQuerySchema,
  type CategoryReport,
  type LedgerSummary,
  type TargetReport,
  type YearCategoryReport
} from "@projeto41/contracts";
import {
  categoryTotals,
  comparePeriods,
  computeTargets,
  distributeShares,
  endOfMonth,
  partialPeriod,
  previousRange,
  previousRangeToDate,
  startOfMonth,
  statementCycleFor,
  monthsElapsedInYear,
  topSlices,
  yearMatrix,
  type Range
} from "@projeto41/finance";
import type { AppDatabase } from "@projeto41/db";
import { z } from "zod";
import type { RoutePlugin } from "./index.js";

/** Hoje no fuso local, em ISO. O livro nao tem hora. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

const currentPeriod = () => today().slice(0, 7);

/** Resolve `from`/`to`, `period` ou `year` num intervalo concreto. */
function resolveRange(query: { from?: string; to?: string; period?: string; year?: number }): Range {
  if (query.period) {
    return { from: startOfMonth(query.period), to: endOfMonth(query.period) };
  }
  if (query.year != null) {
    return { from: `${query.year}-01-01`, to: `${query.year}-12-31` };
  }
  return { from: query.from!, to: query.to! };
}

const sumCents = (rows: { spentCents: number }[]) =>
  rows.reduce((total, row) => total + row.spentCents, 0);

/** Monta o relatorio de categorias para um intervalo. */
function buildCategoryReport(
  db: AppDatabase,
  range: Range,
  options: { kind: "income" | "expense"; compare: boolean; referenceDate: string }
): CategoryReport {
  const rows = categoryTotals(db.ledger.reports.totalsByCategory(range, { kind: options.kind }), {
    range
  });
  // Todas as categorias: a legenda rola e lista cada uma. Quem agrupa as
  // fatias pequenas em "Outras" e a rosca, so no desenho.
  const slices = topSlices(rows, Number.POSITIVE_INFINITY);

  // A participacao das LINHAS da tabela e sobre todas as categorias positivas,
  // independente do corte da rosca — a tabela mostra tudo.
  const shares = distributeShares(rows.map((row) => Math.max(row.spentCents, 0)));
  const budgets = rows
    .map((row) => row.budgetCents)
    .filter((value): value is number => value != null);

  const report: CategoryReport = {
    range,
    kind: options.kind,
    rows: rows.map((row, index) => ({ ...row, sharePerMille: shares[index] ?? 0 })),
    slices,
    totalCents: sumCents(rows),
    budgetTotalCents: budgets.length > 0 ? budgets.reduce((a, b) => a + b, 0) : null,
    comparison: null
  };

  if (!options.compare) return report;

  const reference = today();
  const previous = previousRange(range);
  const info = partialPeriod(range, { today: reference });
  const truncated = previousRangeToDate(range, { today: reference });

  const previousRows = categoryTotals(
    db.ledger.reports.totalsByCategory(previous, { kind: options.kind }),
    { range: previous }
  );
  // Quando o periodo atual e parcial, a comparacao usa o anterior truncado no
  // mesmo dia — senao o relatorio mente todo dia 3.
  const comparisonBase = truncated
    ? categoryTotals(db.ledger.reports.totalsByCategory(truncated, { kind: options.kind }), {
        range: truncated
      })
    : previousRows;

  report.comparison = {
    previousRange: previous,
    previousCents: sumCents(previousRows),
    previousToDateCents: truncated ? sumCents(comparisonBase) : null,
    partial: info.partial,
    daysElapsed: info.daysElapsed,
    daysInPeriod: info.daysInPeriod,
    rows: comparePeriods(rows, comparisonBase)
  };
  return report;
}

function buildTargets(db: AppDatabase, period: string): TargetReport {
  const range: Range = { from: startOfMonth(period), to: endOfMonth(period) };
  const config = db.ledger.budgetPeriods.get(period);
  const people = db.ledger.people.list(false);
  const incomeByPerson = db.ledger.reports.incomeByPerson(range);
  const realizedByPerson = db.ledger.reports.realizedByPerson(range);

  const incomeOverrides = Object.fromEntries(
    config.people.map((row) => [row.personId, row.incomeOverrideCents])
  );
  const targetOverrides = Object.fromEntries(
    config.people.map((row) => [row.personId, row.targetOverrideCents])
  );

  const result = computeTargets({
    splitMode: config.period.splitMode,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      kind: person.kind,
      color: person.color,
      active: person.active
    })),
    incomeByPerson,
    realizedByPerson,
    incomeOverrides,
    targetOverrides,
    totalExpenseTargetCents: config.period.totalExpenseTargetCents,
    pooledIncomeCents: config.period.pooledIncomeCents,
    jointExpenseTargetCents: config.period.jointExpenseTargetCents,
    categoryBudgetSumCents: db.ledger.reports.categoryBudgetSum()
  });

  return {
    period,
    splitMode: config.period.splitMode,
    totalExpenseTargetCents: config.period.totalExpenseTargetCents,
    pooledIncomeCents: config.period.pooledIncomeCents,
    jointExpenseTargetCents: config.period.jointExpenseTargetCents,
    totalTargetCents: result.totalTargetCents,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      color: person.color,
      kind: person.kind,
      incomeCents: incomeByPerson[person.id] ?? 0,
      incomeOverrideCents: incomeOverrides[person.id] ?? null,
      targetOverrideCents: targetOverrides[person.id] ?? null
    })),
    bars: result.bars,
    warnings: result.warnings
  };
}

/**
 * Dashboard, relatorios e alvos.
 *
 * Nenhuma soma acontece no cliente: toda agregacao vem de `packages/finance`,
 * alimentada pelas consultas cruas de `packages/db`.
 */
export const registerLedgerReportsRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/ledger/summary", async (request) => {
    // Sem recorte, o mes corrente — calculado agora, nao quando o servidor
    // subiu. Com recorte (ano, intervalo), o resumo fala do mesmo periodo que
    // a rosca ao lado, e compara com o periodo equivalente anterior.
    const query = request.query as Record<string, unknown>;
    const chosen = ["from", "to", "period", "year"].some((key) => query[key] != null);
    const range = chosen
      ? resolveRange(reportRangeSchema.parse(query))
      : { from: startOfMonth(currentPeriod()), to: endOfMonth(currentPeriod()) };
    const period = range.from.slice(0, 7);
    // Mês em andamento contra o anterior até o mesmo dia: contra o mês inteiro,
    // dia 1 sempre parecia "gastou 97% menos".
    const previous = previousRangeToDate(range, { today: today() }) ?? previousRange(range);

    // Reaproveita o calculo de saldo da fase 1 — nada e reescrito aqui (6.1).
    const balances = db.ledger.balances.consolidated({ asOf: today() });
    const flows = new Map(
      db.ledger.reports.monthSummaryByAccount(range).map((row) => [row.accountId, row])
    );

    // A caixinha tem saldo proprio, fora do saldo da conta atrelada (como no
    // banco): ao lado de cada conta vai quanto esta guardado nas dela.
    const saved = db.ledger.goals.savedByParentAccount(today());

    const summary: LedgerSummary = {
      period,
      consolidated: {
        currentCents: balances.consolidatedCents,
        cardStatementCents: balances.creditCardStatementCents
      },
      accounts: balances.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        color: account.color,
        kind: account.kind,
        personId: account.personId ?? null,
        personName: account.personName,
        currentBalanceCents: account.currentBalanceCents,
        goalsCents: saved.get(account.id) ?? 0,
        paymentAccountId: account.paymentAccountId ?? null,
        // O mesmo ciclo que `balances` usou para `currentStatementCents`.
        statement:
          account.kind === "credit_card" && account.closingDay != null && account.dueDay != null
            ? (() => {
                const cycle = statementCycleFor(today(), account.closingDay, account.dueDay);
                return {
                  amountCents: account.currentStatementCents ?? 0,
                  closingDate: cycle.closingDate,
                  dueDate: cycle.dueDate
                };
              })()
            : null,
        flows: {
          incomeCents: flows.get(account.id)?.incomeCents ?? 0,
          expenseCents: flows.get(account.id)?.expenseCents ?? 0,
          netCents: flows.get(account.id)?.netCents ?? 0
        }
      })),
      month: db.ledger.reports.monthSummary(range),
      previousMonth: db.ledger.reports.monthSummary(previous)
    };
    return summary;
  });

  app.get("/api/ledger/reports/categories", async (request) => {
    const query = categoryReportQuerySchema.parse(request.query);
    const range = resolveRange(query);
    return buildCategoryReport(db, range, {
      kind: query.kind,
      compare: query.compare,
      referenceDate: today()
    });
  });

  app.get("/api/ledger/reports/categories/trend", async (request) => {
    const query = categoryTrendQuerySchema.parse(request.query);
    return db.ledger.reports.trendByCategory({
      categoryIds: query.categoryId,
      months: query.months,
      endMonth: query.endMonth ?? currentPeriod()
    });
  });

  // Planilha anual: categorias x meses, com subtotais e o resultado de cada mes,
  // inteira e, se pedido, em blocos por conta ou por debito/credito.
  app.get("/api/ledger/reports/categories/year", async (request) => {
    const query = yearCategoryQuerySchema.parse(request.query);
    const categories = db.ledger.categories.list({ includeArchived: true });
    const chosen = new Set(query.categoryId ?? []);
    const cells = db.ledger.reports.yearByCategoryMonth({
      year: query.year,
      accountIds: query.accountId,
      categoryIds: query.categoryId
    });
    const monthsElapsed = monthsElapsedInYear(query.year, today());
    const order = categories.map((category) => category.id);
    const total = yearMatrix(cells, {
      include: categories
        .filter((category) => chosen.has(category.id))
        .map((category) => ({
          categoryId: category.id,
          kind: category.kind,
          name: category.name,
          color: category.color
        })),
      order,
      monthsElapsed
    });

    const groups: YearCategoryReport["groups"] = [];
    if (query.groupBy === "account") {
      const ids = new Set(cells.map((cell) => cell.accountId));
      for (const account of db.ledger.accounts.list({ asOf: today() })) {
        if (!ids.has(account.id)) continue;
        groups.push({
          key: `account:${account.id}`,
          label: account.name,
          detail: account.personName ?? null,
          color: account.color,
          matrix: yearMatrix(
            cells.filter((cell) => cell.accountId === account.id),
            { order, monthsElapsed }
          )
        });
      }
    } else if (query.groupBy === "method") {
      // Debito e o que sai direto da conta (Pix, debito, boleto); credito e a
      // compra no cartao. O pagamento da fatura e transferencia e nao entra.
      const methods = [
        {
          key: "debit",
          label: "Débito",
          detail: "Contas: Pix, débito, boleto",
          test: (kind: string) => kind !== "credit_card"
        },
        {
          key: "credit",
          label: "Crédito",
          detail: "Cartões de crédito",
          test: (kind: string) => kind === "credit_card"
        }
      ];
      for (const method of methods) {
        const part = cells.filter((cell) => method.test(cell.accountKind));
        if (part.length === 0) continue;
        groups.push({
          key: method.key,
          label: method.label,
          detail: method.detail,
          color: null,
          matrix: yearMatrix(part, { order, monthsElapsed })
        });
      }
    }

    const report: YearCategoryReport = {
      year: query.year,
      monthsElapsed,
      groupBy: query.groupBy,
      total,
      groups
    };
    return report;
  });

  app.get("/api/ledger/targets", async (request) => {
    const { period } = z
      .object({ period: periodSchema.default(currentPeriod) })
      .parse(request.query);
    return buildTargets(db, period);
  });

  app.put("/api/ledger/targets/:period", async (request) => {
    const { period } = z.object({ period: periodSchema }).parse(request.params);
    db.ledger.budgetPeriods.upsert(period, budgetPeriodInputSchema.parse(request.body));
    return { ok: true, targets: buildTargets(db, period) };
  });

  app.put("/api/ledger/targets/:period/people/:personId", async (request) => {
    const { period, personId } = z
      .object({ period: periodSchema, personId: z.coerce.number().int().positive() })
      .parse(request.params);
    db.ledger.budgetPeriods.upsertPerson(
      period,
      personId,
      personPeriodBudgetInputSchema.parse(request.body)
    );
    return { ok: true, targets: buildTargets(db, period) };
  });
};
