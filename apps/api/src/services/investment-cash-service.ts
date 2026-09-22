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

/** Cria a transferência das duas pontas e devolve o id do `transfer`. */
function createLinkedTransfer(
  db: AppDatabase,
  operation: Operation & { accountId?: number | null },
  amount: LedgerAmount
): number | null {
  const bankAccountId = operation.accountId ?? null;
  const investmentAccountId = investmentAccountFor(db, operation.portfolio);
  if (bankAccountId == null || investmentAccountId == null) return null;
  if (bankAccountId === investmentAccountId) return null;

  // Compra tira do banco e põe na corretora; venda faz o caminho inverso.
  const from = operation.type === "buy" ? bankAccountId : investmentAccountId;
  const to = operation.type === "buy" ? investmentAccountId : bankAccountId;

  const { fromEntryId } = db.ledger.entries.createTransfer({
    fromAccountId: from,
    toAccountId: to,
    date: operation.date,
    amountCents: amount.cents,
    // Transferência para investimento nunca conta no alvo de gastos: é
    // justamente para sobrar dinheiro para investir que o alvo existe (6.4).
    purpose: "investment",
    status: "cleared",
    description: describe(operation),
    notes: amount.note
  });

  const transferId = db.ledger.entries.get(fromEntryId)?.transferId ?? null;
  return transferId;
}

export function registerOperation(
  db: AppDatabase,
  input: Operation & { accountId?: number | null }
): { id: number; transferId: number | null } {
  // Tudo numa transação só: nunca sobra operação sem transferência nem
  // transferência sem operação.
  return db.transaction(() => {
    const settings = readCashSettings(db);
    const id = db.operations.create(input);

    if (!settings.autoDebit || input.accountId == null) {
      return { id, transferId: null };
    }
    const amount = toLedgerCents(db, input);
    const transferId = createLinkedTransfer(db, input, amount);
    if (transferId != null) db.operationLinks.set(id, transferId);
    return { id, transferId };
  });
}

function transferEnds(db: AppDatabase, transferId: number) {
  return db.raw
    .prepare(
      `SELECT from_entry_id AS fromEntryId, to_entry_id AS toEntryId FROM transfers WHERE id = ?`
    )
    .get(transferId) as { fromEntryId: number; toEntryId: number } | undefined;
}

function assertNotReconciled(db: AppDatabase, transferId: number) {
  const ends = transferEnds(db, transferId);
  if (!ends) return;
  for (const entryId of [ends.fromEntryId, ends.toEntryId]) {
    if (db.ledger.entries.get(entryId)?.status === "reconciled") throw new ReconciledLinkError();
  }
}

export function updateOperation(
  db: AppDatabase,
  id: number,
  input: Operation & { accountId?: number | null }
): { transferId: number | null } {
  return db.transaction(() => {
    const settings = readCashSettings(db);
    db.operations.update(id, input);
    const link = db.operationLinks.get(id);

    // Tirar a conta desfaz o vínculo; é o mesmo caminho de "desvincular".
    if (input.accountId == null) {
      if (link) unlinkOperation(db, id);
      return { transferId: null };
    }

    if (!link) {
      if (!settings.autoDebit) return { transferId: null };
      const amount = toLedgerCents(db, input);
      const transferId = createLinkedTransfer(db, input, amount);
      if (transferId != null) db.operationLinks.set(id, transferId);
      return { transferId };
    }

    assertNotReconciled(db, link.transferId);
    const ends = transferEnds(db, link.transferId);
    if (!ends) return { transferId: null };

    const amount = toLedgerCents(db, input);
    const investmentAccountId = investmentAccountFor(db, input.portfolio);
    const bankIsFrom = input.type === "buy";
    const fromAccountId = bankIsFrom ? input.accountId : (investmentAccountId ?? input.accountId);
    const toAccountId = bankIsFrom ? (investmentAccountId ?? input.accountId) : input.accountId;

    // `entries.update` já mantém o par espelhado; basta reescrever a ponta de
    // saída com o valor, a data e a conta novos.
    db.ledger.entries.update(ends.fromEntryId, {
      accountId: fromAccountId,
      date: input.date,
      amountCents: -amount.cents,
      kind: "transfer",
      status: "cleared",
      description: describe(input),
      notes: amount.note
    });
    db.raw
      .prepare("UPDATE entries SET account_id = ?, updated_at = ? WHERE id = ?")
      .run(toAccountId, new Date().toISOString(), ends.toEntryId);

    return { transferId: link.transferId };
  });
}

/** Desfaz o movimento de caixa, mantendo a operação. */
export function unlinkOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const link = db.operationLinks.get(id);
    if (link) {
      assertNotReconciled(db, link.transferId);
      const ends = transferEnds(db, link.transferId);
      db.operationLinks.remove(id);
      if (ends) db.ledger.entries.remove(ends.fromEntryId);
    }
    db.raw.prepare("UPDATE operations SET account_id = NULL WHERE id = ?").run(id);
    return { ok: true as const };
  });
}

export function removeOperation(db: AppDatabase, id: number) {
  return db.transaction(() => {
    const link = db.operationLinks.get(id);
    if (link) {
      // Recusar é a única saída aceitável: deixar transferência órfã ou apagar
      // lançamento conciliado são as duas piores alternativas.
      assertNotReconciled(db, link.transferId);
      const ends = transferEnds(db, link.transferId);
      db.operationLinks.remove(id);
      if (ends) db.ledger.entries.remove(ends.fromEntryId);
    }
    db.operations.remove(id);
    return { ok: true as const };
  });
}

/** Lista as operações já com o estado do vínculo, para a interface não adivinhar. */
export function listOperationsWithLinks(db: AppDatabase, portfolio?: "crypto" | "b3") {
  const operations = db.operations.list(portfolio);
  const links = db.operationLinks.listByOperations(operations.map((operation) => operation.id));
  const byOperation = new Map(links.map((link) => [link.operationId, link]));
  return operations.map((operation) => {
    const link = byOperation.get(operation.id);
    return {
      ...operation,
      accountName: link?.accountName ?? null,
      transferId: link?.transferId ?? null,
      transferStatus: link?.transferStatus ?? null
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
