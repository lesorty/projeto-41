import type {
  GoalCreateInput,
  GoalProgress,
  GoalRecord,
  GoalUpdateInput
} from "@projeto41/contracts";
import {
  accrueLots,
  estimateRedemption,
  goalProgress,
  iofFreeDate,
  projectCompletion,
  type CdiRate,
  type Lot
} from "@projeto41/finance";
import { createEntriesRepository } from "./entries.js";
import { LedgerError, fromBit, notFound, nowIso, today, type Db } from "./shared.js";

const SELECT_GOAL = `
  SELECT g.id, g.name, g.mode, g.account_id AS accountId, a.name AS accountName,
         g.target_amount_cents AS targetAmountCents, g.target_date AS targetDate,
         g.cdi_percent AS cdiPercent, g.color, g.icon, g.archived,
         g.created_at AS createdAt
  FROM goals g
  LEFT JOIN accounts a ON a.id = g.account_id
`;

type GoalRow = Omit<GoalRecord, "archived"> & { archived: number };

const map = (row: GoalRow): GoalRecord => ({ ...row, archived: fromBit(row.archived) });

export function createGoalsRepository(db: Db) {
  const entries = createEntriesRepository(db);

  const holidaySet = () =>
    new Set(
      (db.prepare("SELECT date FROM holidays").all() as { date: string }[]).map(
        (row) => row.date
      )
    );

  const ratesBetween = (from: string, to: string): CdiRate[] =>
    db
      .prepare(
        `SELECT date, daily_factor AS dailyRatePercent FROM cdi_rates
         WHERE date >= ? AND date <= ? ORDER BY date`
      )
      .all(from, to) as CdiRate[];

  /**
   * Os aportes da caixinha como lotes, em ordem de data.
   *
   * Cada entrada de dinheiro na conta da caixinha é um lote; o rendimento já
   * lançado não vira lote novo (ele já está no saldo e não recomeça a contagem
   * de IR). Saques consomem em FIFO.
   */
  function lotsOf(goal: GoalRecord): Lot[] {
    if (goal.accountId == null) return [];
    const rows = db
      .prepare(
        `SELECT date, amount_cents AS amountCents, kind FROM entries
         WHERE account_id = ? ORDER BY date, id`
      )
      .all(goal.accountId) as { date: string; amountCents: number; kind: string }[];

    let lots: Lot[] = [];
    for (const row of rows) {
      if (row.amountCents > 0) {
        lots.push({ principalCents: row.amountCents, startDate: row.date });
      } else if (row.amountCents < 0) {
        // Saque consome o dinheiro mais antigo primeiro.
        let remaining = -row.amountCents;
        const next: Lot[] = [];
        for (const lot of lots) {
          if (remaining <= 0) {
            next.push(lot);
          } else if (lot.principalCents <= remaining) {
            remaining -= lot.principalCents;
          } else {
            next.push({ ...lot, principalCents: lot.principalCents - remaining });
            remaining = 0;
          }
        }
        lots = next;
      }
    }
    return lots;
  }

  /** Saldo: SUM dos lançamentos da conta, ou SUM das alocações na marcação. */
  function balanceOf(goal: GoalRecord, asOf: string): number {
    if (goal.mode === "account" && goal.accountId != null) {
      return (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
             WHERE account_id = ? AND date <= ? AND status IN ('cleared','reconciled')`
          )
          .get(goal.accountId, asOf) as { total: number }
      ).total;
    }
    return (
      db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM goal_allocations WHERE goal_id = ?")
        .get(goal.id) as { total: number }
    ).total;
  }

  const repository = {
    list: (includeArchived = false): GoalRecord[] =>
      (
        db
          .prepare(`${SELECT_GOAL} ${includeArchived ? "" : "WHERE g.archived = 0"} ORDER BY g.id`)
          .all() as GoalRow[]
      ).map(map),

    get: (id: number): GoalRecord | undefined => {
      const row = db.prepare(`${SELECT_GOAL} WHERE g.id = ?`).get(id) as GoalRow | undefined;
      return row ? map(row) : undefined;
    },

    /**
     * No modo conta, a conta `kind='goal'` nasce na **mesma** transação: nunca
     * deixar caixinha sem conta pela metade.
     */
    create: (input: GoalCreateInput): number =>
      db.transaction(() => {
        if (input.cdiPercent != null && input.mode !== "account") {
          throw new LedgerError("Caixinha que rende precisa de conta propria");
        }
        let accountId = input.accountId ?? null;

        if (input.mode === "account") {
          accountId = Number(
            db
              .prepare(
                `INSERT INTO accounts
                 (person_id, name, kind, color, opening_balance_cents, include_in_net_worth,
                  archived, sort_order, created_at)
                 VALUES (?, ?, 'goal', ?, 0, 1, 0, 50, ?)`
              )
              .run(input.personId ?? null, input.name, input.color, nowIso()).lastInsertRowid
          );
        }

        return Number(
          db
            .prepare(
              `INSERT INTO goals
               (name, mode, account_id, target_amount_cents, target_date, cdi_percent,
                color, icon, archived, created_at)
               VALUES (@name, @mode, @accountId, @targetAmountCents, @targetDate, @cdiPercent,
                       @color, @icon, 0, @createdAt)`
            )
            .run({
              name: input.name,
              mode: input.mode,
              accountId,
              targetAmountCents: input.targetAmountCents ?? null,
              targetDate: input.targetDate ?? null,
              cdiPercent: input.cdiPercent ?? null,
              color: input.color,
              icon: input.icon ?? null,
              createdAt: nowIso()
            }).lastInsertRowid
        );
      })(),

    /** `mode` e `account_id` são ignorados mesmo que cheguem no objeto. */
    update: (id: number, input: GoalUpdateInput): number => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (input.cdiPercent != null && goal.mode !== "account") {
        throw new LedgerError("Caixinha que rende precisa de conta propria");
      }
      return db
        .prepare(
          `UPDATE goals SET name=@name, target_amount_cents=@targetAmountCents,
           target_date=@targetDate, cdi_percent=@cdiPercent, color=@color, icon=@icon
           WHERE id=@id`
        )
        .run({
          id,
          name: input.name,
          targetAmountCents: input.targetAmountCents ?? null,
          targetDate: input.targetDate ?? null,
          cdiPercent: input.cdiPercent ?? null,
          color: input.color,
          icon: input.icon ?? null
        }).changes;
    },

    archive: (id: number): number =>
      db.prepare("UPDATE goals SET archived = 1 WHERE id = ?").run(id).changes,

    /** Só apaga sem nenhum movimento; havendo movimento, arquiva. */
    remove: (id: number): { removed: boolean } => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      const moves =
        goal.accountId == null
          ? 0
          : (
              db
                .prepare("SELECT COUNT(*) AS n FROM entries WHERE account_id = ?")
                .get(goal.accountId) as { n: number }
            ).n;
      const allocations = (
        db
          .prepare("SELECT COUNT(*) AS n FROM goal_allocations WHERE goal_id = ?")
          .get(id) as { n: number }
      ).n;

      if (moves > 0 || allocations > 0) {
        repository.archive(id);
        return { removed: false };
      }
      return db.transaction(() => {
        db.prepare("DELETE FROM goals WHERE id = ?").run(id);
        if (goal.accountId != null) {
          db.prepare("DELETE FROM accounts WHERE id = ?").run(goal.accountId);
        }
        return { removed: true };
      })();
    },

    /** Depósito é transferência com `purpose='goal_deposit'` (D20, D21). */
    deposit: (
      id: number,
      input: { amountCents: number; date: string; fromAccountId: number; description?: string | null }
    ) => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (goal.mode !== "account" || goal.accountId == null) {
        throw new LedgerError("Deposito so existe em caixinha com conta propria");
      }
      return entries.createTransfer({
        fromAccountId: input.fromAccountId,
        toAccountId: goal.accountId,
        date: input.date,
        amountCents: input.amountCents,
        purpose: "goal_deposit",
        description: input.description ?? `Depósito · ${goal.name}`
      });
    },

    withdraw: (
      id: number,
      input: { amountCents: number; date: string; toAccountId: number; description?: string | null }
    ) => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (goal.mode !== "account" || goal.accountId == null) {
        throw new LedgerError("Saque so existe em caixinha com conta propria");
      }
      return entries.createTransfer({
        fromAccountId: goal.accountId,
        toAccountId: input.toAccountId,
        date: input.date,
        amountCents: input.amountCents,
        purpose: "goal_withdrawal",
        description: input.description ?? `Saque · ${goal.name}`
      });
    },

    /**
     * Marcação: amarra a caixinha a um lançamento.
     *
     * **Invariante validada dentro da transação:** a soma das alocações de
     * **todas** as caixinhas que marcam a mesma conta nunca pode passar do saldo
     * atual dela. Ultrapassar desfaz tudo e informa o disponível.
     */
    allocate: (id: number, entryId: number, amountCents: number) =>
      db.transaction(() => {
        const goal = repository.get(id);
        if (!goal) throw notFound("Caixinha");
        if (goal.mode !== "earmark") {
          throw new LedgerError("Alocacao so existe em caixinha de marcacao");
        }
        db.prepare(
          `INSERT INTO goal_allocations(goal_id, entry_id, amount_cents) VALUES (?, ?, ?)
           ON CONFLICT(goal_id, entry_id) DO UPDATE SET amount_cents = excluded.amount_cents`
        ).run(id, entryId, amountCents);

        const available = repository.freeBalance(goal.accountId!);
        if (available < 0) {
          throw new LedgerError(
            `As marcacoes passam do saldo da conta em ${Math.abs(available)} centavos`
          );
        }
        return { ok: true as const, freeBalanceCents: available };
      })(),

    deallocate: (id: number, entryId: number) =>
      db.prepare("DELETE FROM goal_allocations WHERE goal_id = ? AND entry_id = ?").run(id, entryId)
        .changes,

    /**
     * Saldo livre de uma conta: saldo atual menos tudo que está marcado. Sem
     * isso o usuário soma a caixinha ao saldo e conta o mesmo dinheiro duas
     * vezes.
     */
    freeBalance: (accountId: number, asOf: string = today()): number => {
      const balance = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM entries
             WHERE account_id = ? AND date <= ? AND status IN ('cleared','reconciled')`
          )
          .get(accountId, asOf) as { total: number }
      ).total;
      const opening = (
        db.prepare("SELECT opening_balance_cents AS o FROM accounts WHERE id = ?").get(accountId) as
          | { o: number }
          | undefined
      )?.o;
      const allocated = (
        db
          .prepare(
            `SELECT COALESCE(SUM(ga.amount_cents), 0) AS total
             FROM goal_allocations ga JOIN goals g ON g.id = ga.goal_id
             WHERE g.account_id = ?`
          )
          .get(accountId) as { total: number }
      ).total;
      return (opening ?? 0) + balance - allocated;
    },

    progress: (id: number, asOf: string = today()): GoalProgress => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");

      const balanceCents = balanceOf(goal, asOf);
      const base = goalProgress({
        balanceCents,
        targetAmountCents: goal.targetAmountCents,
        targetDate: goal.targetDate,
        asOf
      });

      const lots = goal.cdiPercent != null ? lotsOf(goal) : [];
      const firstDate = lots[0]?.startDate ?? asOf;
      const accrual =
        goal.cdiPercent != null
          ? accrueLots({
              lots,
              rates: ratesBetween(firstDate, asOf),
              cdiPercent: goal.cdiPercent,
              from: firstDate,
              to: asOf,
              holidays: holidaySet()
            })
          : null;

      // O resgate hipotético usa o rendimento REALIZADO: projeção não se paga
      // imposto sobre o que ainda não aconteceu.
      const redemption = estimateRedemption({
        asOf,
        lots: (accrual?.lots ?? []).map((lot) => ({
          principalCents: lot.principalCents,
          startDate: lot.startDate,
          yieldCents: lot.realizedYieldCents
        }))
      });

      const newest = lots.at(-1);
      const iofFree = newest ? iofFreeDate(newest.startDate) : null;

      const depositsByMonth = Object.fromEntries(
        (
          db
            .prepare(
              `SELECT substr(date, 1, 7) AS month, COALESCE(SUM(amount_cents), 0) AS total
               FROM entries WHERE account_id = ? AND amount_cents > 0 AND kind = 'transfer'
               GROUP BY month`
            )
            .all(goal.accountId ?? -1) as { month: string; total: number }[]
        ).map((row) => [row.month, row.total])
      );

      const projection = projectCompletion({
        balanceCents,
        targetAmountCents: goal.targetAmountCents,
        depositsByMonth,
        // ~21 dias úteis no mês, com o fator do último dia conhecido.
        monthlyYieldFactor:
          goal.cdiPercent != null && accrual && accrual.principalCents > 0
            ? 1 + ((accrual.realizedYieldCents / accrual.principalCents) || 0)
            : 1,
        asOf
      });

      return {
        ...goal,
        balanceCents,
        ...base,
        realizedYieldCents: accrual?.realizedYieldCents ?? 0,
        realizedThroughDate: accrual?.realizedThroughDate ?? null,
        projectedYieldCents: accrual?.projectedYieldCents ?? 0,
        projectedThroughDate: accrual?.projectedThroughDate ?? null,
        grossCents: balanceCents,
        iofCents: redemption.iofCents,
        irCents: redemption.irCents,
        netCents: balanceCents - redemption.iofCents - redemption.irCents,
        iofFreeFrom: iofFree && iofFree > asOf ? iofFree : null,
        projection
      };
    },

    /**
     * Lança o rendimento realizado como um `income` na conta da caixinha.
     *
     * Idempotência sem coluna nova: numa conta de caixinha toda entrada de
     * dinheiro é `transfer`, logo o **único** `income` possível é rendimento. A
     * última apuração é o `MAX(date)` desses lançamentos, e só se apura depois
     * dela. **Nunca lança dia projetado.**
     */
    accrue: (id: number, through: string = today()): { entryId: number | null; cents: number } => {
      const goal = repository.get(id);
      if (!goal) throw notFound("Caixinha");
      if (goal.cdiPercent == null || goal.accountId == null) return { entryId: null, cents: 0 };

      const last = (
        db
          .prepare(
            `SELECT MAX(date) AS last FROM entries
             WHERE account_id = ? AND kind = 'income'`
          )
          .get(goal.accountId) as { last: string | null }
      ).last;

      const lots = lotsOf(goal);
      if (lots.length === 0) return { entryId: null, cents: 0 };
      const from = last ?? lots[0]!.startDate;

      const accrual = accrueLots({
        lots,
        rates: ratesBetween(from, through),
        cdiPercent: goal.cdiPercent,
        from,
        to: through,
        holidays: holidaySet()
      });
      // Só o realizado vira lançamento; o projetado nunca.
      if (accrual.realizedYieldCents <= 0 || accrual.realizedThroughDate == null) {
        return { entryId: null, cents: 0 };
      }
      // Reapurar o mesmo período não duplica: `from` é a data do último
      // rendimento e ela já foi paga.
      if (last != null && accrual.realizedThroughDate <= last) {
        return { entryId: null, cents: 0 };
      }

      const category = db
        .prepare("SELECT id FROM categories WHERE name = 'Rendimentos' AND kind = 'income'")
        .get() as { id: number } | undefined;

      const entryId = entries.createInternal({
        accountId: goal.accountId,
        date: accrual.realizedThroughDate,
        amountCents: accrual.realizedYieldCents,
        kind: "income",
        status: "cleared",
        categoryId: category?.id ?? null,
        description: `Rendimento CDI · ${from} a ${accrual.realizedThroughDate}`,
        countsTowardTarget: false,
        tagIds: []
      });
      return { entryId, cents: accrual.realizedYieldCents };
    }
  };

  return repository;
}
