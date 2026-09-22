import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

/** Hoje fixo: os testes de fatura não podem depender do relógio. */
const TODAY = "2026-05-15";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;
let card: number;
let mercado: number;

beforeEach(() => {
  // `createDatabase` é o caminho real: roda o `migrate()` legado e, em seguida,
  // o runner versionado. Montar só o runner produz um banco que não existe em
  // produção — sem `operations`, por exemplo.
  ledger = createDatabase(":memory:").ledger;

  steylor = ledger.people.list()[0]!.id;
  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 500000
  });
  // Fecha dia 20, vence dia 27 do mesmo mês.
  card = ledger.accounts.create({
    name: "Cartao",
    kind: "credit_card",
    color: "#f00",
    personId: steylor,
    closingDay: 20,
    dueDay: 27,
    creditLimitCents: 500000,
    paymentAccountId: checking
  });
  mercado = ledger.categories.list().find((c) => c.name === "Mercado")!.id;
});

function cardExpense(date: string, amountCents: number, extra: object = {}) {
  return ledger.entries.create({
    accountId: card,
    date,
    amountCents: -Math.abs(amountCents),
    kind: "expense",
    categoryId: mercado,
    ...extra
  });
}

describe("statement_month na escrita", () => {
  it("calcula a fatura da compra no cartao", () => {
    const id = cardExpense("2026-05-10", 10000);
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-05");
  });

  it("compra na vespera e no dia do fechamento caem em faturas diferentes", () => {
    const onClosing = cardExpense("2026-05-20", 10000);
    const nextDay = cardExpense("2026-05-21", 10000);
    expect(ledger.entries.get(onClosing)?.statementMonth).toBe("2026-05");
    expect(ledger.entries.get(nextDay)?.statementMonth).toBe("2026-06");
  });

  it("respeita o statementMonth informado pelo chamador", () => {
    // É este respeito que faz a antecipação funcionar (6.2).
    const id = cardExpense("2026-05-10", 10000, { statementMonth: "2026-08" });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-08");
  });

  it("recalcula ao mudar a data, quando o chamador nao informa o mes", () => {
    const id = cardExpense("2026-05-10", 10000);
    ledger.entries.update(id, {
      accountId: card,
      date: "2026-05-25",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-06");
  });

  it("zera o statement_month ao mover para conta comum, e preenche ao voltar", () => {
    const id = cardExpense("2026-05-10", 10000);
    ledger.entries.update(id, {
      accountId: checking,
      date: "2026-05-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBeNull();

    ledger.entries.update(id, {
      accountId: card,
      date: "2026-05-10",
      amountCents: -10000,
      kind: "expense",
      categoryId: mercado
    });
    expect(ledger.entries.get(id)?.statementMonth).toBe("2026-05");
  });

  it("lancamento em cartao nasce com forma de pagamento 'credit'", () => {
    expect(ledger.entries.get(cardExpense("2026-05-10", 10000))?.paymentMethod).toBe("credit");
  });
});

describe("os dois numeros do cartao (6.1)", () => {
  it("fatura atual e total devido sao DIFERENTES quando existe parcela futura", () => {
    // O teste mais importante da fase: colapsar os dois num só esconde dinheiro
    // já comprometido.
    ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });

    const summary = ledger.cards.summary(card, TODAY);
    expect(summary.currentStatementMonth).toBe("2026-05");
    expect(summary.currentStatementCents).toBe(10000);
    expect(summary.totalOwedCents).toBe(30000);
    expect(summary.currentStatementCents).not.toBe(summary.totalOwedCents);
  });

  it("limite considera lancamento pendente e parcela futura", () => {
    cardExpense("2026-05-10", 20000, { status: "pending" });
    const summary = ledger.cards.summary(card, TODAY);
    expect(summary.usedCents).toBe(20000);
    expect(summary.availableCents).toBe(480000);
  });

  it("disponivel fica negativo quando o limite estoura, sem truncar", () => {
    cardExpense("2026-05-10", 600000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(-100000);
  });

  it("devolve disponivel nulo quando o cartao nao tem limite cadastrado", () => {
    const noLimit = ledger.accounts.create({
      name: "Sem limite",
      kind: "credit_card",
      color: "#0f0",
      personId: steylor,
      closingDay: 5,
      dueDay: 15
    });
    expect(ledger.cards.summary(noLimit, TODAY).availableCents).toBeNull();
  });

  it("o limite volta ao estornar", () => {
    const id = cardExpense("2026-05-10", 20000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(480000);
    ledger.refunds.create(id, { date: "2026-05-12" });
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(500000);
  });

  it("o cartao fica fora do saldo consolidado (6.1)", () => {
    cardExpense("2026-05-10", 20000);
    const balances = ledger.balances.consolidated({ asOf: TODAY });
    expect(balances.consolidatedCents).toBe(500000);
    expect(balances.creditCardDueCents).toBe(20000);
  });
});

describe("fatura derivada", () => {
  it("lista faturas futuras que contem parcela", () => {
    ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    const months = ledger.statements.list(card, { asOf: TODAY }).map((s) => s.month);
    expect(months).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(ledger.statements.list(card, { asOf: TODAY }).find((s) => s.month === "2026-07")
      ?.isFuture).toBe(true);
  });

  it("a fatura corrente aparece mesmo vazia", () => {
    expect(ledger.statements.list(card, { asOf: TODAY }).map((s) => s.month)).toEqual(["2026-05"]);
  });

  it("percorre open, closed, overdue e paid", () => {
    cardExpense("2026-05-10", 10000);
    const statusAt = (asOf: string) =>
      ledger.statements.list(card, { asOf }).find((s) => s.month === "2026-05")?.status;

    expect(statusAt("2026-05-15")).toBe("open");
    expect(statusAt("2026-05-21")).toBe("closed");
    expect(statusAt("2026-05-28")).toBe("overdue");

    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    expect(statusAt("2026-05-28")).toBe("paid");
  });
});

describe("pagamento de fatura", () => {
  beforeEach(() => {
    cardExpense("2026-05-10", 10000);
  });

  it("cria duas linhas sem categoria e zera a fatura", () => {
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    const from = ledger.entries.get(result.fromEntryId)!;
    const to = ledger.entries.get(result.toEntryId)!;
    expect(from.categoryId).toBeNull();
    expect(to.categoryId).toBeNull();
    expect(from.transferPurpose).toBe("invoice_payment");

    const statement = ledger.statements.get(card, "2026-05", "2026-05-28");
    expect(statement.totalCents).toBe(0);
    expect(statement.payments).toHaveLength(1);
    expect(statement.purchases).toHaveLength(1);
  });

  it("nao aparece em nenhum relatorio de despesa (D21)", () => {
    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    const totals = ledger.reports.totalsByCategory({ from: "2026-05-01", to: "2026-05-31" });
    expect(totals.reduce((sum, row) => sum + row.totalCents, 0)).toBe(10000);
  });

  it("fica na fatura paga, nao na do mes em que a data cai", () => {
    // 27/05 é depois do fechamento de 20/05, então o cálculo natural jogaria o
    // pagamento na fatura de junho.
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    expect(ledger.entries.get(result.toEntryId)?.statementMonth).toBe("2026-05");
  });

  it("recusa pagamento parcial (D12)", () => {
    expect(() =>
      ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 5000 })
    ).toThrow(/parcial/i);
  });

  it("recusa pagar o cartao com outro cartao ou com ele mesmo", () => {
    expect(() =>
      ledger.statements.pay(card, "2026-05", {
        date: "2026-05-27",
        amountCents: 10000,
        fromAccountId: card
      })
    ).toThrow();
  });

  it("desfazer devolve o saldo devedor e o limite", () => {
    const result = ledger.statements.pay(card, "2026-05", {
      date: "2026-05-27",
      amountCents: 10000
    });
    const transferId = ledger.entries.get(result.fromEntryId)!.transferId!;
    ledger.statements.undoPayment(transferId);

    expect(ledger.statements.get(card, "2026-05", TODAY).totalCents).toBe(10000);
    expect(ledger.cards.summary(card, TODAY).availableCents).toBe(490000);
  });
});

describe("antecipacao de parcelas", () => {
  let planId: number;
  let installments: ReturnType<LedgerRepositories["installmentPlans"]["installments"]>;

  beforeEach(() => {
    planId = ledger.installmentPlans.create({
      accountId: card,
      purchaseDate: "2026-05-10",
      totalCents: 30000,
      installmentCount: 3,
      categoryId: mercado
    });
    installments = ledger.installmentPlans.installments(planId);
  });

  it("move so o statement_month, deixando a data intacta", () => {
    const last = installments.find((row) => row.installmentNumber === 3)!;
    expect(last.statementMonth).toBe("2026-07");

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });
    const moved = ledger.entries.get(last.id)!;
    expect(moved.statementMonth).toBe("2026-05");
    expect(moved.date).toBe(last.date);
  });

  it("nao cria nem destroi dinheiro: sai da origem, entra no destino, total igual", () => {
    const before = ledger.cards.summary(card, TODAY).totalOwedCents;
    const last = installments.find((row) => row.installmentNumber === 3)!;

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });

    const statements = ledger.statements.list(card, { asOf: TODAY });
    expect(statements.find((s) => s.month === "2026-05")?.totalCents).toBe(20000);
    expect(statements.find((s) => s.month === "2026-07")?.totalCents ?? 0).toBe(0);
    expect(ledger.cards.summary(card, TODAY).totalOwedCents).toBe(before);
  });

  it("antecipar e restaurar devolve exatamente o estado original", () => {
    const last = installments.find((row) => row.installmentNumber === 3)!;
    const original = ledger.entries.get(last.id)!;

    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });
    expect(ledger.statements.isAnticipated(last.id)).toBe(true);

    ledger.statements.restoreNatural([last.id]);
    const restored = ledger.entries.get(last.id)!;
    expect(restored.statementMonth).toBe(original.statementMonth);
    expect(restored.date).toBe(original.date);
    expect(ledger.statements.isAnticipated(last.id)).toBe(false);
  });

  it("recusa antecipar para uma fatura ja paga", () => {
    ledger.statements.pay(card, "2026-05", { date: "2026-05-27", amountCents: 10000 });
    const last = installments.find((row) => row.installmentNumber === 3)!;
    expect(() =>
      ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" })
    ).toThrow(/ja paga/i);
  });

  it("recusa antecipar lancamento de outro cartao", () => {
    const other = ledger.entries.create({
      accountId: checking,
      date: "2026-05-10",
      amountCents: -1000,
      kind: "expense"
    });
    expect(() =>
      ledger.statements.anticipate(card, { entryIds: [other], targetMonth: "2026-05" })
    ).toThrow(/nao pertence/i);
  });

  it("restaurar depois de mudar o ciclo leva ao novo natural, nao ao antigo", () => {
    // Escolha documentada: o mês natural é derivado da configuração ATUAL.
    const last = installments.find((row) => row.installmentNumber === 3)!;
    ledger.statements.anticipate(card, { entryIds: [last.id], targetMonth: "2026-05" });

    ledger.accounts.update(card, {
      name: "Cartao",
      kind: "credit_card",
      color: "#f00",
      personId: steylor,
      closingDay: 5,
      dueDay: 15,
      creditLimitCents: 500000,
      paymentAccountId: checking
    });
    ledger.statements.restoreNatural([last.id]);
    // Com fechamento 05 e vencimento 15, 10/07 fecha em 05/08 e vence em 15/08.
    expect(ledger.entries.get(last.id)?.statementMonth).toBe("2026-08");
  });
});
