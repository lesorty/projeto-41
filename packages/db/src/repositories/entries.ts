import type {
  AttachmentRecord,
  EntryFilter,
  EntryInput,
  EntryListResult,
  EntryRecord,
  TagRecord,
  TransferInput
} from "@projeto41/contracts";
import { statementMonthFor } from "@projeto41/finance";
import { createAccountsRepository } from "./accounts.js";
import { LedgerError, fromBit, notFound, nowIso, toBit, type Db } from "./shared.js";

const SELECT_COLUMNS = `
  e.id,
  e.account_id AS accountId,
  a.name AS accountName,
  a.kind AS accountKind,
  e.person_id AS personId,
  p.name AS personName,
  p.color AS personColor,
  e.date,
  e.amount_cents AS amountCents,
  e.kind,
  e.status,
  e.category_id AS categoryId,
  c.name AS categoryName,
  c.color AS categoryColor,
  e.place_id AS placeId,
  pl.name AS placeName,
  e.description,
  e.notes,
  e.raw_description AS rawDescription,
  e.payment_method AS paymentMethod,
  e.statement_month AS statementMonth,
  e.installment_plan_id AS installmentPlanId,
  e.installment_number AS installmentNumber,
  e.refund_of_entry_id AS refundOfEntryId,
  e.counts_toward_target AS countsTowardTarget,
  e.created_at AS createdAt,
  e.updated_at AS updatedAt,
  t.id AS transferId,
  t.purpose AS transferPurpose,
  CASE WHEN t.from_entry_id = e.id THEN t.to_entry_id ELSE t.from_entry_id END AS counterpartEntryId
`;

const FROM_JOINS = `
  FROM entries e
  JOIN accounts a ON a.id = e.account_id
  LEFT JOIN people p ON p.id = e.person_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN places pl ON pl.id = e.place_id
  LEFT JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
`;

type EntryRow = Omit<
  EntryRecord,
  "countsTowardTarget" | "tags" | "attachments" | "installmentCount" | "counterpartAccountId" | "counterpartAccountName"
> & {
  countsTowardTarget: number;
  counterpartEntryId: number | null;
};

/** Ramos de WHERE construidos a partir do filtro validado. */
function buildWhere(filter: Partial<EntryFilter>) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    clauses.push("e.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    clauses.push("e.date <= @to");
    params.to = filter.to;
  }
  if (filter.kind) {
    clauses.push("e.kind = @kind");
    params.kind = filter.kind;
  } else if (filter.includeTransfers === false) {
    clauses.push("e.kind <> 'transfer'");
  }
  if (filter.accountId) {
    clauses.push("e.account_id = @accountId");
    params.accountId = filter.accountId;
  }
  if (filter.personId) {
    clauses.push("e.person_id = @personId");
    params.personId = filter.personId;
  }
  if (filter.placeId) {
    clauses.push("e.place_id = @placeId");
    params.placeId = filter.placeId;
  }
  if (filter.status) {
    clauses.push("e.status = @status");
    params.status = filter.status;
  }
  if (filter.statementMonth) {
    clauses.push("e.statement_month = @statementMonth");
    params.statementMonth = filter.statementMonth;
  }
  if (filter.installmentPlanId) {
    clauses.push("e.installment_plan_id = @installmentPlanId");
    params.installmentPlanId = filter.installmentPlanId;
  }
  if (filter.categoryId && filter.categoryId.length > 0) {
    // Lista de ids vem validada como inteiros pelo contrato, entao interpolar
    // aqui e seguro e evita gerar N placeholders nomeados.
    clauses.push(`e.category_id IN (${filter.categoryId.join(",")})`);
  }
  if (filter.tagId && filter.tagId.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id
               AND et.tag_id IN (${filter.tagId.join(",")}))`
    );
  }
  if (filter.search) {
    clauses.push(
      `(e.description LIKE @search OR e.notes LIKE @search
        OR e.raw_description LIKE @search OR pl.name LIKE @search)`
    );
    params.search = `%${filter.search}%`;
  }
  // Os limites comparam magnitude: o usuario pensa "gastos acima de 100",
  // nao "lancamentos com amount_cents >= -10000".
  if (filter.minCents != null) {
    clauses.push("ABS(e.amount_cents) >= @minCents");
    params.minCents = Math.abs(filter.minCents);
  }
  if (filter.maxCents != null) {
    clauses.push("ABS(e.amount_cents) <= @maxCents");
    params.maxCents = Math.abs(filter.maxCents);
  }

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function createEntriesRepository(db: Db) {
  const accounts = createAccountsRepository(db);

  /**
   * Resolve pessoa e mes de fatura a partir da conta.
   *
   * Pessoa e herdada da conta quando nao informada (D01). `statement_month` e
   * calculado na escrita para contas de cartao e pode vir sobrescrito — e assim
   * que a antecipacao de parcela funciona (plano mestre 6.2).
   */
  function resolveAccountDefaults(input: {
    accountId: number;
    personId?: number | null;
    date: string;
    statementMonth?: string | null;
  }) {
    const account = accounts.raw(input.accountId);
    if (!account) throw notFound("Conta");

    let statementMonth = input.statementMonth ?? null;
    if (account.kind === "credit_card" && !statementMonth) {
      if (account.closingDay == null || account.dueDay == null) {
        throw new LedgerError("Cartao sem ciclo configurado");
      }
      statementMonth = statementMonthFor(input.date, account.closingDay, account.dueDay);
    }
    if (account.kind !== "credit_card") statementMonth = null;

    return {
      personId: input.personId ?? account.personId ?? null,
      statementMonth,
      accountKind: account.kind
    };
  }

  /** Despesa e negativa, receita e positiva — menos em estorno (6.6). */
  function normalizeAmount(input: Pick<EntryInput, "kind" | "amountCents" | "refundOfEntryId">) {
    if (input.refundOfEntryId != null) return input.amountCents;
    const magnitude = Math.abs(input.amountCents);
    if (input.kind === "expense") return -magnitude;
    if (input.kind === "income") return magnitude;
    return input.amountCents;
  }

  function replaceTags(entryId: number, tagIds: number[] | undefined) {
    if (!tagIds) return;
    db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(entryId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO entry_tags(entry_id, tag_id) VALUES (?, ?)"
    );
    for (const tagId of tagIds) insert.run(entryId, tagId);
  }

  const insertStatement = db.prepare(
    `INSERT INTO entries
     (account_id, person_id, date, amount_cents, kind, status, category_id, place_id,
      description, notes, raw_description, payment_method, statement_month,
      installment_plan_id, installment_number, parent_entry_id, refund_of_entry_id,
      counts_toward_target, external_id, import_row_id, content_hash, created_at, updated_at)
     VALUES (@accountId, @personId, @date, @amountCents, @kind, @status, @categoryId, @placeId,
             @description, @notes, @rawDescription, @paymentMethod, @statementMonth,
             @installmentPlanId, @installmentNumber, @parentEntryId, @refundOfEntryId,
             @countsTowardTarget, @externalId, @importRowId, @contentHash, @createdAt, @updatedAt)`
  );

  /** Os campos extras so sao preenchidos pelas fases 3 (parcelas) e 6 (importacao). */
  function insertRow(
    input: EntryInput & {
      installmentPlanId?: number | null;
      installmentNumber?: number | null;
      parentEntryId?: number | null;
      rawDescription?: string | null;
      externalId?: string | null;
      importRowId?: number | null;
      contentHash?: string | null;
    }
  ): number {
    const defaults = resolveAccountDefaults(input);
    const timestamp = nowIso();
    const id = Number(
      insertStatement.run({
        accountId: input.accountId,
        personId: defaults.personId,
        date: input.date,
        amountCents: normalizeAmount(input),
        kind: input.kind,
        status: input.status ?? "cleared",
        categoryId: input.kind === "transfer" ? null : (input.categoryId ?? null),
        placeId: input.placeId ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        rawDescription: input.rawDescription ?? null,
        paymentMethod: input.paymentMethod ?? null,
        statementMonth: defaults.statementMonth,
        installmentPlanId: input.installmentPlanId ?? null,
        installmentNumber: input.installmentNumber ?? null,
        parentEntryId: input.parentEntryId ?? null,
        refundOfEntryId: input.refundOfEntryId ?? null,
        countsTowardTarget: toBit(input.countsTowardTarget, input.kind === "expense"),
        externalId: input.externalId ?? null,
        importRowId: input.importRowId ?? null,
        contentHash: input.contentHash ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      }).lastInsertRowid
    );
    replaceTags(id, input.tagIds);
    return id;
  }

  const repository = {
    create: (input: EntryInput): number => db.transaction(() => insertRow(input))(),

    /** Usado pelas fases 3 e 6, que precisam gravar campos internos. */
    createInternal: (
      input: Parameters<typeof insertRow>[0]
    ): number => insertRow(input),

    get: (id: number): EntryRecord | undefined => {
      const rows = repository.hydrate(
        db.prepare(`SELECT ${SELECT_COLUMNS} ${FROM_JOINS} WHERE e.id = ?`).all(id) as EntryRow[]
      );
      return rows[0];
    },

    /**
     * Anexa a cada linha as etiquetas, os anexos, o total de parcelas do plano e
     * a conta da outra ponta da transferencia. Tudo em consultas agregadas pelo
     * conjunto de ids da pagina, para nao gerar N+1.
     */
    hydrate: (rows: EntryRow[]): EntryRecord[] => {
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id).join(",");

      const tagsByEntry = new Map<number, TagRecord[]>();
      for (const row of db
        .prepare(
          `SELECT et.entry_id AS entryId, t.id, t.name, t.color
           FROM entry_tags et JOIN tags t ON t.id = et.tag_id
           WHERE et.entry_id IN (${ids}) ORDER BY t.name`
        )
        .all() as (TagRecord & { entryId: number })[]) {
        const { entryId, ...tag } = row;
        const list = tagsByEntry.get(entryId) ?? [];
        list.push(tag);
        tagsByEntry.set(entryId, list);
      }

      const attachmentsByEntry = new Map<number, AttachmentRecord[]>();
      for (const row of db
        .prepare(
          `SELECT id, entry_id AS entryId, mime, byte_size AS byteSize, width, height,
                  original_name AS originalName, created_at AS createdAt
           FROM attachments WHERE entry_id IN (${ids}) ORDER BY id`
        )
        .all() as AttachmentRecord[]) {
        const list = attachmentsByEntry.get(row.entryId) ?? [];
        list.push(row);
        attachmentsByEntry.set(row.entryId, list);
      }

      const counterpartIds = rows
        .map((row) => row.counterpartEntryId)
        .filter((value): value is number => value != null);
      const counterparts = new Map<number, { accountId: number; accountName: string }>();
      if (counterpartIds.length > 0) {
        for (const row of db
          .prepare(
            `SELECT e.id, e.account_id AS accountId, a.name AS accountName
             FROM entries e JOIN accounts a ON a.id = e.account_id
             WHERE e.id IN (${counterpartIds.join(",")})`
          )
          .all() as { id: number; accountId: number; accountName: string }[]) {
          counterparts.set(row.id, { accountId: row.accountId, accountName: row.accountName });
        }
      }

      const planIds = rows
        .map((row) => row.installmentPlanId)
        .filter((value): value is number => value != null);
      const planCounts = new Map<number, number>();
      if (planIds.length > 0 && tableExists(db, "installment_plans")) {
        for (const row of db
          .prepare(
            `SELECT id, installment_count AS installmentCount
             FROM installment_plans WHERE id IN (${planIds.join(",")})`
          )
          .all() as { id: number; installmentCount: number }[]) {
          planCounts.set(row.id, row.installmentCount);
        }
      }

      return rows.map((row) => {
        const { counterpartEntryId, ...rest } = row;
        const counterpart = counterpartEntryId != null ? counterparts.get(counterpartEntryId) : undefined;
        return {
          ...rest,
          countsTowardTarget: fromBit(row.countsTowardTarget),
          installmentCount:
            row.installmentPlanId != null ? (planCounts.get(row.installmentPlanId) ?? null) : null,
          counterpartAccountId: counterpart?.accountId ?? null,
          counterpartAccountName: counterpart?.accountName ?? null,
          tags: tagsByEntry.get(row.id) ?? [],
          attachments: attachmentsByEntry.get(row.id) ?? []
        } satisfies EntryRecord;
      });
    },

    list: (filter: Partial<EntryFilter> = {}): EntryListResult => {
      const { where, params } = buildWhere(filter);
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 50;

      const total = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM (SELECT e.id ${FROM_JOINS} ${where} GROUP BY e.id)`
          )
          .get(params) as { n: number }
      ).n;

      // Os totais do rodape cobrem o filtro inteiro, nao so a pagina visivel.
      const totals = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN kind = 'income' THEN amountCents END), 0) AS incomeCents,
             COALESCE(SUM(CASE WHEN kind = 'expense' THEN amountCents END), 0) AS expenseCents,
             COALESCE(SUM(CASE WHEN kind IN ('income','expense') THEN amountCents END), 0) AS netCents
           FROM (SELECT e.id, e.kind, e.amount_cents AS amountCents ${FROM_JOINS} ${where}
                 GROUP BY e.id)`
        )
        .get(params) as { incomeCents: number; expenseCents: number; netCents: number };

      const rows = db
        .prepare(
          `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${where}
           GROUP BY e.id
           ORDER BY e.date DESC, e.id DESC
           LIMIT @limit OFFSET @offset`
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as EntryRow[];

      return { rows: repository.hydrate(rows), total, page, pageSize, totals };
    },

    /**
     * Cria as duas pontas de uma transferencia numa transacao so (D20). E a
     * unica maneira de criar transferencia: pontas soltas nao existem.
     */
    createTransfer: (input: TransferInput): { fromEntryId: number; toEntryId: number } => {
      if (input.fromAccountId === input.toAccountId) {
        throw new LedgerError("Conta de origem e destino precisam ser diferentes");
      }
      const magnitude = Math.abs(input.amountCents);

      return db.transaction(() => {
        const fromEntryId = insertRow({
          accountId: input.fromAccountId,
          personId: input.personId ?? null,
          date: input.date,
          amountCents: -magnitude,
          kind: "transfer",
          status: input.status ?? "cleared",
          description: input.description ?? null,
          notes: input.notes ?? null,
          // Deposito em caixinha e consumo adiado e conta no alvo; investimento
          // e o oposto, e justamente o que se quer que sobre (plano mestre 6.4).
          countsTowardTarget: input.purpose === "goal_deposit",
          tagIds: []
        });
        const toEntryId = insertRow({
          accountId: input.toAccountId,
          personId: input.personId ?? null,
          date: input.date,
          amountCents: magnitude,
          kind: "transfer",
          status: input.status ?? "cleared",
          statementMonth: input.statementMonth ?? null,
          description: input.description ?? null,
          notes: input.notes ?? null,
          countsTowardTarget: false,
          tagIds: []
        });
        db.prepare(
          `INSERT INTO transfers(from_entry_id, to_entry_id, purpose, created_at)
           VALUES (?, ?, ?, ?)`
        ).run(fromEntryId, toEntryId, input.purpose ?? "generic", nowIso());
        return { fromEntryId, toEntryId };
      })();
    },

    /**
     * Atualiza um lancamento. Mexer numa ponta de transferencia arrasta a outra
     * na mesma transacao: data, valor e status precisam continuar espelhados.
     */
    update: (id: number, input: EntryInput): number =>
      db.transaction(() => {
        const existing = db
          .prepare(
            `SELECT e.id, e.kind, t.id AS transferId, t.from_entry_id AS fromEntryId,
                    t.to_entry_id AS toEntryId
             FROM entries e
             LEFT JOIN transfers t ON t.from_entry_id = e.id OR t.to_entry_id = e.id
             WHERE e.id = ?`
          )
          .get(id) as
          | { id: number; kind: string; transferId: number | null; fromEntryId: number | null; toEntryId: number | null }
          | undefined;
        if (!existing) throw notFound("Lancamento");

        const defaults = resolveAccountDefaults({ ...input, statementMonth: input.statementMonth });
        const amount = normalizeAmount(input);

        db.prepare(
          `UPDATE entries SET account_id=@accountId, person_id=@personId, date=@date,
           amount_cents=@amountCents, kind=@kind, status=@status, category_id=@categoryId,
           place_id=@placeId, description=@description, notes=@notes,
           payment_method=@paymentMethod, statement_month=@statementMonth,
           refund_of_entry_id=@refundOfEntryId, counts_toward_target=@countsTowardTarget,
           updated_at=@updatedAt
           WHERE id=@id`
        ).run({
          id,
          accountId: input.accountId,
          personId: defaults.personId,
          date: input.date,
          amountCents: amount,
          kind: input.kind,
          status: input.status ?? "cleared",
          categoryId: input.kind === "transfer" ? null : (input.categoryId ?? null),
          placeId: input.placeId ?? null,
          description: input.description ?? null,
          notes: input.notes ?? null,
          paymentMethod: input.paymentMethod ?? null,
          statementMonth: defaults.statementMonth,
          refundOfEntryId: input.refundOfEntryId ?? null,
          countsTowardTarget: toBit(input.countsTowardTarget, input.kind === "expense"),
          updatedAt: nowIso()
        });
        replaceTags(id, input.tagIds);

        if (existing.transferId != null) {
          const otherId = existing.fromEntryId === id ? existing.toEntryId : existing.fromEntryId;
          if (otherId != null) {
            db.prepare(
              `UPDATE entries SET date = ?, amount_cents = ?, status = ?, description = ?,
               updated_at = ? WHERE id = ?`
            ).run(
              input.date,
              -amount,
              input.status ?? "cleared",
              input.description ?? null,
              nowIso(),
              otherId
            );
          }
        }
        return 1;
      })(),

    /** Remover uma ponta remove a outra e a linha de `transfers`, em cascata. */
    remove: (id: number): number =>
      db.transaction(() => {
        const transfer = db
          .prepare(
            `SELECT id, from_entry_id AS fromEntryId, to_entry_id AS toEntryId
             FROM transfers WHERE from_entry_id = ? OR to_entry_id = ?`
          )
          .get(id, id) as
          | { id: number; fromEntryId: number; toEntryId: number }
          | undefined;

        if (transfer) {
          db.prepare("DELETE FROM transfers WHERE id = ?").run(transfer.id);
          db.prepare("DELETE FROM entries WHERE id IN (?, ?)").run(
            transfer.fromEntryId,
            transfer.toEntryId
          );
          return 2;
        }
        const changes = db.prepare("DELETE FROM entries WHERE id = ?").run(id).changes;
        if (changes === 0) throw notFound("Lancamento");
        return changes;
      })(),

    /** Marca em lote, usado pelos botoes de conciliacao da listagem. */
    setStatus: (ids: number[], status: "pending" | "cleared" | "reconciled"): number => {
      if (ids.length === 0) return 0;
      return db
        .prepare(
          `UPDATE entries SET status = ?, updated_at = ?
           WHERE id IN (${ids.map(() => "?").join(",")})`
        )
        .run(status, nowIso(), ...ids).changes;
    },

    /** Linhas cruas de um filtro, sem paginacao — usado pela exportacao CSV. */
    listAll: (filter: Partial<EntryFilter> = {}): EntryRecord[] => {
      const { where, params } = buildWhere(filter);
      const rows = db
        .prepare(
          `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ${where}
           GROUP BY e.id ORDER BY e.date DESC, e.id DESC`
        )
        .all(params) as EntryRow[];
      return repository.hydrate(rows);
    }
  };

  return repository;
}

function tableExists(db: Db, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name)
  );
}
