import type { Operation } from "@projeto41/contracts";
import type { AppDatabase } from "@projeto41/db";
import { toCents } from "@projeto41/finance";

/**
 * Débito e crédito automáticos no livro quando se registra uma operação.
 *
 * **Esta é a única fronteira entre o `REAL` do módulo de investimentos e os
 * centavos do livro.** Nenhum outro lugar converte: `toLedgerCents` abaixo é o
 * ponto de passagem, e a cotação usada fica registrada na nota das duas pontas
 * para o número ser auditável depois.
 */

export class ReconciledLinkError extends Error {
  statusCode = 409;

  constructor() {
    super(
      "Operacao vinculada a um lancamento ja conciliado. Desvincule antes de excluir."
    );
    this.name = "ReconciledLinkError";
  }
}

export type CashSettings = {
  autoDebit: boolean;
  defaultAccountId: number | null;
  cryptoAccountId: number | null;
  b3AccountId: number | null;
};

const readNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export function readCashSettings(db: AppDatabase): CashSettings {
  return {
    autoDebit: (db.settings.get("investment.auto_debit") ?? "1") === "1",
    defaultAccountId: readNumber(db.settings.get("investment.default_account_id")),
    cryptoAccountId: readNumber(db.settings.get("investment.crypto_account_id")),
    b3AccountId: readNumber(db.settings.get("investment.b3_account_id"))
  };
}

export function writeCashSettings(db: AppDatabase, settings: CashSettings) {
  db.settings.set("investment.auto_debit", settings.autoDebit ? "1" : "0");
  db.settings.set(
    "investment.default_account_id",
    settings.defaultAccountId == null ? "" : String(settings.defaultAccountId)
  );
  if (settings.cryptoAccountId != null) {
    db.settings.set("investment.crypto_account_id", String(settings.cryptoAccountId));
  }
  if (settings.b3AccountId != null) {
    db.settings.set("investment.b3_account_id", String(settings.b3AccountId));
  }
}

export type LedgerAmount = { cents: number; note: string | null };

/**
 * Converte o total da operação para centavos de BRL.
 *
 * Operação em USD sem cotação **lança**: é melhor recusar do que gravar um
 * débito errado que o usuário só descobriria conferindo o extrato.
 */
export function toLedgerCents(db: AppDatabase, operation: Operation): LedgerAmount {
  if (operation.currency !== "USD") {
    return { cents: toCents(operation.total), note: null };
  }
  const usdBrl = db.prices.get("USDBRL")?.price ?? 0;
  if (!usdBrl) {
    throw Object.assign(
      new Error("Sem cotacao do dolar para converter a operacao em USD"),
      { statusCode: 400 }
    );
  }
  return {
    cents: toCents(operation.total * usdBrl),
    note: `USDBRL ${usdBrl.toFixed(4).replace(".", ",")} em ${operation.date}`
  };
}

function describe(operation: Operation): string {
  const verb = operation.type === "buy" ? "Compra" : "Venda";
  const quantity = operation.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 });
  return `${verb} ${operation.asset} ${quantity}`;
}

function investmentAccountFor(db: AppDatabase, portfolio: "crypto" | "b3"): number | null {
  const settings = readCashSettings(db);
  return portfolio === "crypto" ? settings.cryptoAccountId : settings.b3AccountId;
}

/**
 * O caminho do dinheiro numa operação (migração 009):
 *
 *     banco ──aporte──▶ caixa da corretora ──compra──▶ ativo
 *     banco ◀─resgate── caixa da corretora ◀──venda─── ativo
 *
 * Toda compra consome o caixa da corretora e toda venda o repõe — é o
 * lançamento de caixa, `kind='adjustment'`, que nenhum relatório de gasto vê.
 * Pagar direto de uma conta bancária é o mesmo caminho com um aporte
 * automático antes: o banco manda o valor para o caixa e o caixa compra. Na
 * venda para o banco, o caixa recebe e resgata na hora.
 *
 * `accountId` na operação diz de onde sai (ou para onde vai) o dinheiro:
 * a própria conta de corretora é "usar o caixa"; outra conta é "aporte
 * automático"; nulo é "não movimentar".
 */
function createCashLegs(
  db: AppDatabase,
  operationId: number,
  operation: Operation & { accountId?: number | null },
  amount: LedgerAmount
): { transferId: number | null; cashEntryId: number | null } {
  const sourceId = operation.accountId ?? null;
  const brokerId = investmentAccountFor(db, operation.portfolio);
  if (sourceId == null || brokerId == null) return { transferId: null, cashEntryId: null };

  const buying = operation.type === "buy";
  const cashEntryId = db.ledger.entries.create({
    accountId: brokerId,
    date: operation.date,
    amountCents: buying ? -amount.cents : amount.cents,
    kind: "adjustment",
    status: "cleared",
    description: describe(operation),
    notes: amount.note
  });
  db.operationLinks.setCash(operationId, cashEntryId);

  if (sourceId === brokerId) return { transferId: null, cashEntryId };

  const { fromEntryId } = db.ledger.entries.createTransfer({
    fromAccountId: buying ? sourceId : brokerId,
    toAccountId: buying ? brokerId : sourceId,
    date: operation.date,
    amountCents: amount.cents,
    // Transferência para investimento nunca conta no alvo de gastos: é
    // justamente para sobrar dinheiro para investir que o alvo existe (6.4).
    purpose: "investment",
    status: "cleared",
    description: `${buying ? "Aporte" : "Resgate"} · ${describe(operation)}`,
    notes: amount.note
  });
  const transferId = db.ledger.entries.get(fromEntryId)?.transferId ?? null;
  if (transferId != null) db.operationLinks.set(operationId, transferId);
  return { transferId, cashEntryId };
}

function transferEnds(db: AppDatabase, transferId: number) {
  return db.raw
    .prepare(
      `SELECT from_entry_id AS fromEntryId, to_entry_id AS toEntryId FROM transfers WHERE id = ?`
    )
    .get(transferId) as { fromEntryId: number; toEntryId: number } | undefined;
}

/** Lançamento conciliado bate com um extrato: apagar desmentiria a conferência. */
function assertLegsNotReconciled(db: AppDatabase, operationId: number) {
  const ids: number[] = [];
  const link = db.operationLinks.get(operationId);
  if (link) {
    const ends = transferEnds(db, link.transferId);
    if (ends) ids.push(ends.fromEntryId, ends.toEntryId);
  }
  const cash = db.operationLinks.getCash(operationId);
  if (cash) ids.push(cash.entryId);
  for (const entryId of ids) {
    if (db.ledger.entries.get(entryId)?.status === "reconciled") throw new ReconciledLinkError();
  }
}

/** Desfaz o movimento de caixa da operação (aporte automático e lançamento de caixa). */
function removeCashLegs(db: AppDatabase, operationId: number): boolean {
  assertLegsNotReconciled(db, operationId);
  const link = db.operationLinks.get(operationId);
  const cash = db.operationLinks.getCash(operationId);
  if (link) {
    const ends = transferEnds(db, link.transferId);
    db.operationLinks.remove(operationId);
    if (ends) db.ledger.entries.remove(ends.fromEntryId);
  }
  if (cash) {
    db.operationLinks.removeCash(operationId);
    db.ledger.entries.remove(cash.entryId);
  }
  return Boolean(link || cash);
}

export function registerOperation(
  db: AppDatabase,
  input: Operation & { accountId?: number | null }
): { id: number; transferId: number | null } {
  // Tudo numa transação só: nunca sobra operação sem lançamento de caixa nem
  // lançamento sem operação.
  return db.transaction(() => {
    const settings = readCashSettings(db);
    const id = db.operations.create(input);
    if (!settings.autoDebit || input.accountId == null) return { id, transferId: null };
    const { transferId } = createCashLegs(db, id, input, toLedgerCents(db, input));
    return { id, transferId };
  });
}

/**
 * Editar refaz o movimento de caixa do zero. Remendar ponta por ponta era
 * frágil com três caminhos possíveis (caixa, aporte automático, nenhum), e o
 * resultado de refazer é o mesmo que o de registrar a operação já editada.
 */
export function updateOperation(
  db: AppDatabase,
  id: number,
  input: Operation & { accountId?: number | null }
): { transferId: number | null } {
  return db.transaction(() => {
    const settings = readCashSettings(db);
    const amount = input.accountId == null ? null : toLedgerCents(db, input);
    const hadLegs = removeCashLegs(db, id);
    db.operations.update(id, input);
    if (amount == null || (!hadLegs && !settings.autoDebit)) return { transferId: null };
    return { transferId: createCashLegs(db, id, input, amount).transferId };
  });
}

/** Desfaz o movimento de caixa, mantendo a operação. */
export function unlinkOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    removeCashLegs(db, id);
    db.raw.prepare("UPDATE operations SET account_id = NULL WHERE id = ?").run(id);
    return { ok: true as const };
  });
}

export function removeOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    // Recusar é a única saída aceitável: deixar lançamento órfão ou apagar
    // lançamento conciliado são as duas piores alternativas.
    removeCashLegs(db, id);
    db.operations.remove(id);
    return { ok: true as const };
  });
}

/** Lista as operações já com o estado do vínculo, para a interface não adivinhar. */
export function listOperationsWithLinks(db: AppDatabase, portfolio?: "crypto" | "b3") {
  const operations = db.operations.list(portfolio);
  const links = db.operationLinks.listByOperations(operations.map((operation) => operation.id));
  const byOperation = new Map(links.map((link) => [link.operationId, link]));
  const cash = new Map(
    (
      db.raw
        .prepare(
          `SELECT oc.operation_id AS operationId, e.status
           FROM operation_cash_entries oc
           JOIN entries e ON e.id = oc.entry_id`
        )
        .all() as { operationId: number; status: string }[]
    ).map((row) => [row.operationId, row])
  );
  const names = new Map(
    (db.raw.prepare("SELECT id, name FROM accounts").all() as { id: number; name: string }[]).map(
      (row) => [row.id, row.name]
    )
  );
  return operations.map((operation) => {
    const link = byOperation.get(operation.id);
    const cashLeg = cash.get(operation.id);
    const moved = Boolean(link || cashLeg);
    return {
      ...operation,
      // De onde saiu (ou para onde foi) o dinheiro: a conta bancária do aporte
      // automático, ou o próprio caixa da corretora.
      accountName:
        moved && operation.accountId != null ? (names.get(operation.accountId) ?? null) : null,
      transferId: link?.transferId ?? null,
      transferStatus: link?.transferStatus ?? cashLeg?.status ?? null,
      cashSource: link ? ("bank" as const) : cashLeg ? ("broker" as const) : null
    };
  });
}

/** Limpar a carteira inteira: recusa se qualquer operação tiver ponta conciliada. */
export function clearOperations(db: AppDatabase, portfolio?: "crypto" | "b3") {
  const operations = db.operations.list(portfolio);
  const links = db.operationLinks.listByOperations(operations.map((operation) => operation.id));
  const blocked = links.filter((link) => link.transferStatus === "reconciled");
  if (blocked.length > 0) {
    throw Object.assign(
      new Error(
        `${blocked.length} operacao(oes) estao vinculadas a lancamentos ja conciliados. ` +
          "Desvincule antes de limpar a carteira."
      ),
      { statusCode: 409 }
    );
  }
  return db.transaction(() => {
    for (const operation of operations) removeOperation(db, operation.id);
    return operations.length;
  });
}
